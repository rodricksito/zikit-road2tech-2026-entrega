# Preparación de Claude API (P03)

Responsable: **rodricksito**. Estado: **sin uso en la entrega**: la app no llama a la Claude API (el detector no usa IA). Datos consultados en la documentación oficial el 2026-10-09; los precios cambiaron el 7 de octubre, así que conviene revisarlos de nuevo el día del evento.

Usar Claude en el prototipo todavía depende de P04 (solución) y de que el mentor lo permita. Este documento deja lista la configuración para no improvisarla después; no implica que la solución vaya a usar IA.

## Decisiones de rodricksito (2026-10-09)

| Tema | Decisión |
| --- | --- |
| Control de gasto | Workspace exclusivo `zikit-hackaton` con su propio límite de gasto mensual; se puede subir si una medición lo justifica |
| Dónde corre el backend | Laptop de rodricksito; la clave vive en un `.env` local |
| Quién tiene la clave | Solo rodricksito. La interfaz y las pruebas llaman al backend, nunca directamente a la API |

Pendientes: crear la clave cuando haga falta y permiso del mentor para usar un LLM externo.

## Créditos

El saldo, la caducidad y el límite de gasto se revisaron en la Console; los datos de la cuenta no se publican.

## Precios

Por millón de tokens, para prompts de hasta 100,000 tokens. La columna de costo estimado supone 3,000 tokens de entrada y 1,500 de salida por llamada, sin caché.

| Modelo | Entrada | Salida | Lectura de caché | Costo estimado por llamada | Llamadas por cada 100 USD |
| --- | --- | --- | --- | --- | --- |
| `claude-opus-5-5` | 4.00 USD | 20.00 USD | 0.20 USD | 0.042 USD | ≈ 2,380 |
| `claude-sonnet-5-5` | 2.00 USD | 10.00 USD | 0.10 USD | 0.021 USD | ≈ 4,760 |
| `claude-haiku-5-5` | 0.10 USD | 0.50 USD | 0.01 USD | 0.001 USD | ≈ 95,000 |

- El razonamiento (*thinking*) se cobra como salida aunque su texto no se devuelva. En Opus 5.5 no se puede desactivar; el parámetro `effort` es el principal control de costo.
- La salida representa alrededor del 70 % del costo de cada llamada.
- La Batch API descuenta 50 %, pero un lote puede tardar hasta 24 horas: no sirve para la demo en vivo.
- Los tamaños por llamada son supuestos. Hay que medirlos con `response.usage` en cuanto exista una llamada real.

## Qué implica para el reto (estimaciones)

Datos del kit, según la API de GitHub del repositorio del mentor: 54 corridas, 4 empresas y 2,024,000 filas de métricas.

- **Consultar a Claude por cada minuto no es viable** ni por costo ni por tiempo.
- `contexto.md` pesa unos 1 KB por empresa y tiene el mismo tamaño en todas las corridas. Convertirlo en un calendario de eventos normales costaría centavos.
- `logs.md` pesa unos 82 KB por empresa y corrida. Leer todos los logs de las 216 combinaciones costaría del orden de 20 USD con Opus 5.5, 10 con Sonnet 5.5 y menos de 1 con Haiku 5.5, solo en entrada.
- Una explicación por alerta en 2,000 alertas de validación costaría unos 84 USD con Opus 5.5, 42 con Sonnet 5.5 y 2 con Haiku 5.5.

Si se usa Claude, conviene guardar sus respuestas para no repetir llamadas en cada validación. El modelo se elige en P04.

## Pasos en la Console

1. ~~Iniciar sesión en <https://platform.claude.com> con el mismo correo de claude.ai.~~ Hecho.
2. ~~Anotar saldo, caducidad y nivel.~~ Hecho.
3. ~~Reclamar los créditos desde claude.ai.~~ Ya estaban acreditados.
4. ~~Crear el workspace `zikit-hackaton`.~~ Hecho el 2026-10-09.
5. ~~Fijar su límite de gasto.~~ Hecho. Al alcanzarlo, la API responde `400 invalid_request_error` («…specified workspace API usage limits»). Se cambia en Workspace → Gestionar → Límites de gasto.
6. Crear, **dentro de `zikit-hackaton`** (Claves de API → Crear clave), una clave con caducidad de **7 días**. Si se crea el 9 o el 10 de octubre, vence el 16 o el 17 y avisa por correo un día antes. Las de 3 horas o 1 día podrían vencer durante la demo y no avisan.
7. Guardar la clave únicamente en el `.env` de la laptop. Nunca en el repositorio, el chat, los Issues ni el código de la interfaz.
8. Revocar la clave al terminar el hackatón.

El gasto se sigue en <https://platform.claude.com/cost>. No existe un endpoint documentado para consultar el saldo.

## Configuración del servidor

Se aplica cuando P04 confirme que se usará Claude.

- La laptop tiene Python 3.13.3; el SDK `anthropic` 1.x requiere 3.10 o superior y aún no está instalado. Propuesta: fijar `anthropic==1.13.0`, publicada el 9 de octubre, para que todas las máquinas usen la misma versión.
- El SDK lee `ANTHROPIC_API_KEY` del entorno. `.gitignore` ya excluye `.env` y `.env.*` y deja pasar `.env.example`.
- El backend debe comprobar al arrancar que `ANTHROPIC_API_KEY` no esté vacía. El SDK trata una variable vacía como ausente: puede usar otro perfil de la máquina o fallar recién en la primera petición.
- Fijar `timeout` y `max_retries`. Por defecto son 600 s y 2 reintentos: en el peor caso, unos 30 minutos de espera. Por ejemplo, `timeout=30` y `max_retries=1` dejan el peor caso en unos 60 s. Antes hay que medir la latencia real.
- Registrar el `request_id` de cada error para poder diagnosticarlo.
- Hacer la prueba de conexión solo cuando haga falta.

## Errores de la API (insumo para P05)

Clases de excepción de `anthropic` 1.13.0, leídas del código fuente del SDK. Hay que comprobarlas al instalarlo.

| Excepción | Causa | ¿Reintentar? |
| --- | --- | --- |
| `AuthenticationError` (401) | Clave mal escrita, revocada o caducada | No: configuración |
| `PermissionDeniedError` (403) | La clave no tiene permiso | No: configuración |
| `NotFoundError` (404) | Modelo o workspace incorrecto | No: configuración |
| `BadRequestError` (400) | Petición inválida o límite de gasto del workspace alcanzado | No |
| `RateLimitError` (429) | Límite de solicitudes, que es transitorio. Si `error_code` es `enforced_spend_limit_reached`, se agotó el tope del nivel y no es transitorio | Solo el transitorio |
| `OverloadedError` (529), `InternalServerError` (5xx), `APITimeoutError`, `APIConnectionError` | API no disponible | El SDK ya reintentó: usar la respuesta de respaldo |
| `APIStatusError` | Otros casos, como `402 billing_error` o un error a mitad de *streaming* | No |

Sin documentar: el código HTTP del mensaje «credit balance is too low». Se comprobará con la primera respuesta real.

## Pendientes

- [x] Saldo, caducidad y nivel revisados en la Console.
- [x] Workspace `zikit-hackaton` con límite de gasto mensual.
- [ ] Crear la clave del workspace cuando P04 confirme el uso de Claude (la crea rodricksito).
- [ ] Preguntar al mentor si se permite un LLM externo que solo reciba datos del kit hasta el minuto *t*.
- [ ] Decidir en P04 si la solución usa Claude, para qué y con qué modelo.

## Fuentes

- Precios: <https://platform.claude.com/docs/en/about-claude/pricing>
- Créditos para suscriptores: <https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers>
- Niveles, límites y topes de gasto: <https://platform.claude.com/docs/en/api/rate-limits>
- Workspaces: <https://platform.claude.com/docs/en/manage-claude/workspaces>
- Claves y caducidad: <https://platform.claude.com/docs/en/manage-claude/authentication>
- Errores: <https://platform.claude.com/docs/en/api/errors>
- Razonamiento y `effort`: <https://platform.claude.com/docs/en/build-with-claude/thinking>, <https://platform.claude.com/docs/en/build-with-claude/effort>
- Buenas prácticas de claves: <https://support.claude.com/en/articles/9767949-api-key-best-practices-keeping-your-keys-safe-and-secure>
- SDK de Python: <https://github.com/anthropics/anthropic-sdk-python> (v1.13.0)

Algunas citas de support.claude.com se leyeron con una herramienta que resume; las de platform.claude.com salen del texto original.
