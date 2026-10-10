"""«Lo normal» aprendido del pasado de la propia corrida (modo adaptable).

Para cada minuto t y cada métrica hay dos fuentes, y se usa UNA (la explicación dice cuál):

1. Días anteriores de esta semana (en cuanto los hay): mediana, a la misma hora del día, de los
   días previos de la corrida (hasta 7). Con varios días, un día raro (una falla) no mueve la
   mediana. Aquí no se usa nada del kit salvo los umbrales en σ.
2. Arranque en frío (todavía no hay un día anterior aprendible a esa hora): la FORMA del día del
   kit (config/calibracion.json) corregida con lo visto de esta semana: desplazamiento (+) o escala
   (× en la latencia) aprendidos de las primeras 6 h con dato (adaptacion.desplazamiento_inicial).
   La forma de otra semana no es más fiable que un solo día de esta: el margen es el de un perfil
   de 1 día (ruido aprendido × √2) y nunca menor que el ruido del kit.

Cambio de nivel sostenido (un escalón de carga, no una falla): si durante las últimas 24 h (un día
completo, para no confundir la noche con el horario de oficina) los cuatro tramos de 6 h quedan
todos a más de 2σ de lo normal, del mismo lado, y a menos de 1σ entre sí, el nivel cambió y se
quedó quieto: se acepta. Desde ese minuto, los días anteriores al cambio se suben (o bajan) lo que
subió el nivel, y lo mismo el arranque en frío. Una falla lenta (un disco que se llena) sigue
subiendo, así que sus tramos no quedan parejos y nunca se acepta; tampoco un uso de 90 % o más.
Cuenta también lo que pasa con un caso abierto (si no, el propio escalón, al abrir un caso, impediría
aprenderlo); los eventos del calendario no cuentan.

- Escala del ruido (días anteriores): cuánto se mueve la media de 15 min alrededor de su mediana
  de las 3 h previas (mediana de |desvío| / 0.6745, solo con el pasado). No incluye cambios lentos
  de nivel, así que una falla lenta no infla el ruido. Mínimo: 1 % del nivel habitual. Con pocos
  días, lo normal también tiene ruido y el margen se ensancha (ver incertidumbre_perfil).
- Tendencia de 3 h: cuánto subió en 3 h menos lo que suele subir en esas 3 h otros días (o, en
  frío, lo que sube según la forma del kit).
- Errores esperados por minuto: con días anteriores, su mediana a esa hora mezclada con la tasa
  de las 24 h previas (sin la última hora); en frío, esa tasa de 24 h partiendo de la del kit × la
  escala de esta semana (adaptacion.escala_errores), que pesa como 1 h de datos.
- Los minutos con un caso abierto o dentro de un evento del calendario no enseñan (`aprender`).

Todas las ventanas miran hacia atrás; las centradas (±7 o ±30 min) solo se usan desplazadas
≥ 1 día, así que tampoco ven el futuro.
"""
import numpy as np
import pandas as pd

from . import adaptacion
from .senales import HORAS_TEND, MET, suavizar

DIA = 1440
DIAS_MAX = 7  # días anteriores que entran en el perfil
VENTANA_BASE = 180  # minutos de la mediana con la que se mide el ruido
MIN_BASE = 60  # minutos con dato para esa mediana
MIN_ESCALA = 120  # minutos de historia antes de confiar en la escala del ruido
MIN_ESCALA_TEND = 240
ESCALA_MIN_REL = 0.01  # piso de la escala: 1 % del nivel habitual de la métrica
K_MAD = 0.6745  # mediana de |N(0, 1)|
PSEUDO_MIN_ERR = 60  # en λ: la tasa de 24 h pesa como 60 min junto a los días anteriores; en frío, el kit pesa como 60 min de datos
# Varianza de la mediana de n valores con ruido normal, en unidades de σ² (n = 0…7 días)
MIN_DIAS_DISPERSION = 3  # con 3+ días, la mediana de las diferencias ignora un día raro
VAR_MEDIANA = np.array([0.0, 1.0, 0.5, 0.448, 0.298, 0.286, 0.215, 0.211])

DIAS_ANTERIORES = "dias_anteriores"
KIT_AJUSTADO = "perfil_kit_ajustado"
ULTIMAS_24H = "ultimas_24h_y_kit"


def _mediana_dias(x: np.ndarray, valido: np.ndarray | None = None, dispersion: bool = False):
    """Mediana de x en t − 1 día, t − 2 días, … (hasta DIAS_MAX), solo con valores aprendibles.

    Devuelve (mediana, cuántos días aportaron[, dispersión entre días]). NaN donde no hay ningún
    día anterior. La dispersión (MAD × 1.4826) dice cuánto difieren esos días entre sí; con menos de
    MIN_DIAS_DISPERSION días es 0 (con dos días sería solo su diferencia, y si una falla lenta ya
    empezó, esa diferencia es la falla: ensancharía el margen justo cuando no conviene)."""
    x = np.asarray(x, float)
    if valido is not None:
        x = np.where(valido, x, np.nan)
    n = len(x)
    lags = np.full((DIAS_MAX, n), np.nan)
    for j in range(1, DIAS_MAX + 1):
        if j * DIA >= n:
            break
        lags[j - 1, j * DIA:] = x[:n - j * DIA]
    med, cuenta = _mediana_filas(lags)
    if not dispersion:
        return med, cuenta
    disp, _ = _mediana_filas(np.abs(lags - med[None, :]))
    return med, cuenta, np.where(cuenta >= MIN_DIAS_DISPERSION, 1.4826 * disp, 0.0)


def _mediana_filas(lags: np.ndarray):
    """Mediana por columna ignorando NaN (rápida: ordena una vez) y cuántos valores había."""
    cuenta = np.isfinite(lags).sum(axis=0)
    orden = np.sort(lags, axis=0)  # los NaN quedan al final
    lo = np.clip((cuenta - 1) // 2, 0, lags.shape[0] - 1)
    hi = np.clip(cuenta // 2, 0, lags.shape[0] - 1)
    med = 0.5 * (np.take_along_axis(orden, lo[None], 0)[0] + np.take_along_axis(orden, hi[None], 0)[0])
    return np.where(cuenta > 0, med, np.nan), cuenta


def incertidumbre_perfil(n_dias: np.ndarray) -> np.ndarray:
    """Factor del margen por el ruido del propio perfil: lo normal es la mediana de n días, que
    también tiene ruido (1 día: ×1.41; 2: ×1.22; 7: ×1.10). Sin días anteriores: 1."""
    n = np.clip(np.asarray(n_dias, int), 0, DIAS_MAX)
    return np.sqrt(1 + VAR_MEDIANA[n])


def escala_pasada(r: np.ndarray, aprender: np.ndarray, min_n: int, piso: np.ndarray) -> np.ndarray:
    """|r| típico de los minutos ANTERIORES a t que se pueden aprender, en unidades de σ."""
    a = pd.Series(np.where(aprender & np.isfinite(r), np.abs(r), np.nan))
    sig = a.expanding(min_periods=min_n).median().shift(1).values / K_MAD
    return np.where(np.isfinite(sig), np.maximum(sig, piso), np.nan)


def _lags(x: np.ndarray) -> np.ndarray:
    """x en t − 1 día, t − 2 días, … (hasta DIAS_MAX): matriz (DIAS_MAX, n), NaN donde no hay."""
    n = len(x)
    lags = np.full((DIAS_MAX, n), np.nan)
    for j in range(1, DIAS_MAX + 1):
        if j * DIA >= n:
            break
        lags[j - 1, j * DIA:] = x[:n - j * DIA]
    return lags


def nivel_sostenido(r: np.ndarray, sigma: np.ndarray, nivel60: np.ndarray | None, desde: int):
    """Primer minuto t ≥ desde en que el residuo r (medido − normal) muestra un cambio de nivel
    sostenido y quieto en las últimas 24 h (ver el encabezado). Devuelve (t, inicio del cambio, Δ) o
    None. Solo usa r hasta t."""
    T, K = adaptacion.TRAMO, adaptacion.TRAMOS
    q = pd.Series(r).rolling(T, min_periods=T // 2).median()
    tramos = np.column_stack([q.shift(k * T).values for k in range(K)])  # NaN si falta alguno
    q_min, q_max = tramos.min(axis=1), tramos.max(axis=1)
    parejo = q_max - q_min < adaptacion.ESTABLE_SIGMAS * sigma
    sube = (q_min > adaptacion.SUBE_SIGMAS * sigma) & parejo
    baja = (q_max < -adaptacion.SUBE_SIGMAS * sigma) & parejo
    if nivel60 is not None:
        sube &= ~(np.asarray(nivel60, float) >= adaptacion.TECHO_PCT)
    cand = np.flatnonzero((sube | baja)[desde:])
    if not len(cand):
        return None
    t = desde + int(cand[0])
    delta = float(np.median(tramos[t]))
    # Inicio del cambio: después del último momento (en las 24 h) en que la mediana de 60 min aún no
    # había cruzado la mitad del escalón.
    m60 = pd.Series(r).rolling(60, min_periods=30).median().values
    ini = max(0, t - K * T)
    antes = m60[ini:t + 1] < delta / 2 if delta > 0 else m60[ini:t + 1] > delta / 2
    k = np.flatnonzero(antes)
    return t, ini + (int(k[-1]) + 1 if len(k) else 0), delta


def preparar(met: pd.DataFrame, ce: dict, mod: np.ndarray, hr: np.ndarray) -> dict:
    """Series que no dependen de qué se puede aprender (se calculan una vez por corrida).
    `ce`: calibración del kit de la empresa; en el arranque en frío solo se usa su FORMA (perfil por
    minuto del día y λ por hora) y su escala de ruido, siempre corregidas con la semana."""
    prep = {}
    for m in MET:
        s15, s60 = suavizar(met[m])
        v60 = s60.values
        k15 = np.asarray(ce["perfil15"][m], float)[mod]
        k60 = np.asarray(ce["perfil60"][m], float)[mod]
        prep[m] = dict(
            s15=s15.values, s60=s60,
            base=s15.rolling(VENTANA_BASE, min_periods=MIN_BASE).median().values,
            # Fuente del perfil: ±7 min; si ese día faltó el dato a esa hora, ±30 min. Solo se usa desplazada ≥ 1 día.
            suave15=s15.rolling(15, center=True, min_periods=5).median().fillna(
                s15.rolling(61, center=True, min_periods=5).median()).values,
            d_raw=v60 - pd.Series(v60).shift(HORAS_TEND).values,
            # Arranque en frío: forma del kit, lo que suele subir en 3 h según esa forma y su ruido
            kit15=k15, kit_dp=k60 - pd.Series(k60).shift(HORAS_TEND).values,
            kit_sig=float(ce["sigma_nivel"][m]), kit_sig_t=float(ce["sigma_tendencia"][m]),
            kit_sig_rel=float(ce["sigma_nivel"][m]) / float(np.nanmedian(ce["perfil15"][m])),
        )
    prep["errores"] = met["errores"].values.astype(float)
    prep["lam_kit"] = np.asarray(ce["lambda_hora"], float)[hr]
    return prep


def _kit_ajustado(p: dict, m: str, b: int, excluir: np.ndarray):
    """Arranque en frío de una métrica: (lo normal, lo que suele subir en 3 h) = forma del kit
    corregida con lo aprendido en las primeras 6 h con dato de esta semana. Causal."""
    v15, k15 = p["s15"][:b], p["kit15"][:b]
    if m in adaptacion.PROPORCIONALES:
        a = adaptacion.desplazamiento_inicial(v15 / k15 - 1, excluir)
        return k15 * (1 + a), p["kit_dp"][:b] * (1 + a)
    a = adaptacion.desplazamiento_inicial(v15 - k15, excluir)
    return k15 + a, p["kit_dp"][:b]


def _normal(lags, g, n_kit, sig_kit, ruido):
    """Lo normal con los cambios de nivel aceptados (g: nivel acumulado en cada minuto, en retrospectiva):
    cada día anterior se corrige con lo que cambió el nivel entre ese día y hoy."""
    corr = lags + g[None, :] - _lags(g)
    p_dia, nd = _mediana_filas(corr)
    disp, _ = _mediana_filas(np.abs(corr - p_dia[None, :]))
    disp = np.where(nd >= MIN_DIAS_DISPERSION, 1.4826 * disp, 0.0)
    de_dias = np.isfinite(p_dia)
    normal = np.where(de_dias, p_dia, n_kit + g)
    sigma = np.where(de_dias, np.maximum(ruido, disp) * incertidumbre_perfil(nd), sig_kit)
    return normal, sigma, de_dias


def metricas(prep: dict, aprender: np.ndarray, evento: np.ndarray | None = None) -> dict:
    """Señales de métricas para los primeros len(aprender) minutos.

    `aprender[t]`: el minuto t puede enseñar «lo normal» (no está en un caso abierto ni en un evento).
    `evento[t]`: el minuto t está en un evento del calendario (no cuenta para aceptar un cambio de nivel).
    Devuelve por métrica: normal (lo que se usó), de_dias (si vino de días anteriores), kit (la forma
    del kit en ese minuto, para explicar el ajuste), cambio (nivel aceptado acumulado) y cambio_desde
    (minuto en que empezó el último cambio aceptado, −1 si ninguno), sigma, z y zt."""
    b = len(aprender)
    evento = np.zeros(b, bool) if evento is None else np.asarray(evento, bool)[:b]
    aprender_3h = pd.Series(aprender).shift(HORAS_TEND, fill_value=False).values
    out = {}
    for m in MET:
        p = prep[m]
        v15, base, d_raw = p["s15"][:b], p["base"][:b], p["d_raw"][:b]
        ok = aprender & np.isfinite(p["suave15"][:b])
        nivel = pd.Series(np.where(aprender & np.isfinite(v15), v15, np.nan)).expanding(min_periods=1).median().shift(1).values
        piso = np.where(np.isfinite(nivel), np.maximum(ESCALA_MIN_REL * np.abs(nivel), 1e-6), np.nan)

        # Ruido: cuánto se mueve la media de 15 min alrededor de su mediana de las 3 h previas
        ruido = escala_pasada(v15 - base, aprender, MIN_ESCALA, piso)

        # 1) Días anteriores. Margen: el ruido (más el del propio perfil) o, si los días anteriores
        #    no se parecen entre sí a esa hora (p. ej. semana y fin de semana), lo que difieren.
        # 2) Arranque en frío: forma del kit corregida con la semana. Otra semana no es más fiable que un
        #    día propio: margen = el de un perfil de 1 día (ruido × √2), nunca menor que el ruido del kit.
        lags = _lags(np.where(ok, p["suave15"][:b], np.nan))
        n_kit, dp_kit = _kit_ajustado(p, m, b, ~aprender)
        sig_kit = np.fmax(p["kit_sig"], ruido * incertidumbre_perfil(1))
        # Cambios de nivel sostenidos: se buscan en orden; cada uno vale desde el minuto siguiente.
        g = np.zeros(b)
        cambio, cambio_desde = np.zeros(b), np.full(b, -1)
        nivel60 = None if m in adaptacion.PROPORCIONALES else p["s60"].values[:b]
        normal, sigma, de_dias = _normal(lags, g, n_kit, sig_kit, ruido)
        visto = (normal, sigma)  # lo normal con todos los cambios aceptados hasta ahora, en retrospectiva
        t0 = 0
        while t0 < b:
            hallado = nivel_sostenido(np.where(evento, np.nan, v15 - visto[0]), visto[1], nivel60, t0)
            if hallado is None:
                break
            t, ini, delta = hallado
            g[ini:] += delta
            cambio[t + 1:] += delta
            cambio_desde[t + 1:] = ini
            nuevo = _normal(lags, g, n_kit, sig_kit, ruido)
            normal, sigma, de_dias = (np.concatenate([viejo[:t + 1], nv[t + 1:]])
                                      for viejo, nv in zip((normal, sigma, de_dias), nuevo))
            visto = nuevo[:2]
            t0 = t + 1
        z = (v15 - normal) / sigma

        # Tendencia de 3 h menos lo que suele subir en esas mismas 3 h en días anteriores (en frío,
        # según la forma del kit). El ruido de 3 h se mide en la propia serie, más la incertidumbre
        # del descuento; en frío, el del kit.
        ok_d = aprender & aprender_3h & np.isfinite(d_raw)
        corr, nc = _mediana_dias(d_raw, ok_d)
        con_dias = np.isfinite(corr)
        d = np.where(con_dias, d_raw - corr, d_raw - dp_kit)
        sig_t = np.where(con_dias, escala_pasada(d_raw, ok_d, MIN_ESCALA_TEND, piso) * incertidumbre_perfil(nc),
                         p["kit_sig_t"])
        out[m] = dict(normal=normal, de_dias=de_dias, kit=p["kit15"][:b], cambio=cambio, cambio_desde=cambio_desde,
                      sigma=sigma, z=z, zt=d / sig_t)
    return out


def lambda_errores(prep: dict, aprender: np.ndarray, congelar: np.ndarray | None = None):
    """Errores esperados por minuto con el pasado aprendible de la corrida: (λ, de_dias, ρ, peso del kit).

    Con días anteriores a esa hora: su mediana mezclada con la tasa de las 24 h previas (sin la
    última hora, para no tragarse la falla que se está midiendo). En frío: la tasa de esas mismas
    24 h previas, partiendo del kit: λ del kit a esa hora × ρ (la escala de errores de esta semana,
    que no sube mientras `congelar`: hay evidencia reciente en las métricas y esos errores pueden ser
    parte de la falla) pesa como PSEUDO_MIN_ERR minutos de datos, así que la semana manda en cuanto
    hay unas horas. La forma por hora del kit es de OTRA semana (con sus propios incidentes), así que
    solo sirve para empezar."""
    b = len(aprender)
    e = pd.Series(np.where(aprender, prep["errores"][:b], np.nan))
    previa = e.shift(60)
    suma = previa.rolling(DIA, min_periods=1).sum().fillna(0.0).values
    cuenta = previa.rolling(DIA, min_periods=1).count().fillna(0.0).values
    lam_g = np.where(cuenta >= 60, (suma + 1.0) / (cuenta + 1.0), np.nan)
    # Misma hora en días anteriores (ventana centrada de 61 min, usada desplazada ≥ 1 día)
    tasa = e.rolling(61, center=True, min_periods=30).mean().values
    lam_h, nd = _mediana_dias(tasa)
    w = nd * 60.0
    lam_dias = (w * lam_h + PSEUDO_MIN_ERR * lam_g) / (w + PSEUDO_MIN_ERR)
    lam_kit = prep["lam_kit"][:b]
    rho = adaptacion.escala_errores(pd.Series(prep["errores"][:b]), lam_kit, ~aprender,
                                    None if congelar is None else congelar[:b])
    peso_kit = PSEUDO_MIN_ERR / (PSEUDO_MIN_ERR + cuenta)
    lam_frio = peso_kit * lam_kit * rho + (1 - peso_kit) * suma / np.maximum(cuenta, 1)
    de_dias = (nd > 0) & np.isfinite(lam_dias)
    return np.where(de_dias, lam_dias, lam_frio), de_dias, rho, np.where(de_dias, 0.0, peso_kit)
