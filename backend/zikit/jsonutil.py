"""JSON estricto: los valores no finitos (NaN, infinito) salen como null."""
import json
import math

import numpy as np


def limpio(x):
    if isinstance(x, (float, np.floating)):
        x = float(x)
        return x if math.isfinite(x) else None
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    if isinstance(x, dict):
        return {k: limpio(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [limpio(v) for v in x]
    return x


def escribir(ruta, datos, **kw):
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(limpio(datos), fh, ensure_ascii=False, allow_nan=False, **kw)
