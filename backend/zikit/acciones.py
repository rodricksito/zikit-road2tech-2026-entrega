"""Acción sugerida y nombre legible por tipo de incidente. Las escribe el equipo; no usa IA."""

NOMBRES = {
    "capacidad_disco": "Disco cerca de llenarse",
    "seguridad_acceso": "Posible ataque de acceso",
    "trafico_anomalo": "Tráfico anómalo",
    "agotamiento_conexiones": "Conexiones a punto de agotarse",
    "memoria": "Memoria en aumento",
    "base_de_datos": "Problema en la base de datos",
    "red_enlace": "Falla de red o de un enlace externo",
    "degradacion_rendimiento": "Servicio cada vez más lento",
    "anomalia_generica": "Comportamiento anómalo",
}

ACCIONES = {
    "capacidad_disco": "Liberar espacio en el volumen afectado (archivos temporales y exportaciones), averiguar qué proceso lo está llenando y confirmar que el próximo respaldo tendrá lugar.",
    "seguridad_acceso": "Revisar los intentos fallidos de acceso (VPN), bloquear temporalmente el rango de origen y forzar el cambio de contraseña de las cuentas afectadas.",
    "trafico_anomalo": "Aplicar un límite de conexiones al rango sospechoso y vigilar la latencia del servicio público.",
    "agotamiento_conexiones": "Revisar el pool de conexiones, cerrar las conexiones colgadas y limitar las conexiones por cliente.",
    "memoria": "Identificar el proceso que crece en memoria y programar su reinicio controlado fuera del horario crítico.",
    "base_de_datos": "Revisar consultas lentas y bloqueos en la base de datos y terminar las transacciones colgadas.",
    "red_enlace": "Verificar el enlace o el proveedor externo y activar la ruta o el canal de respaldo.",
    "degradacion_rendimiento": "Revisar los procesos que más consumen CPU y preparar un reinicio controlado del servicio antes del siguiente horario de uso.",
    "anomalia_generica": "Revisar las métricas y los logs recientes del servidor para identificar la causa.",
}
