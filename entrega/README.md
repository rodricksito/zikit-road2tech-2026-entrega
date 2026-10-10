# Entrega: alertas del kit público

Lista de alertas en el formato del reto (`tenant,timestamp,confianza,tipo`), un archivo por conjunto del
[kit público](https://github.com/brunovillarrrrrr/zikit-dataset) (commit `cdea481`): `alertas_raiz.csv` y
`alertas_corrida_01.csv` … `alertas_corrida_54.csv`, con las 4 empresas (gracko, gramo, kaiku y ttr).

- **Cómo se generaron:** con el detector de este repositorio en su modo por omisión (adaptable), mediante
  `GET /api/entrega.csv?corrida=<conjunto>`; es el mismo archivo que da el enlace «Entrega · todas las
  empresas (CSV)» de la app. Fin de línea CRLF, igual que `python -m zikit detectar`.
- **Totales (medidos):** 774 alertas en los 55 conjuntos; por empresa: gracko 165, gramo 165, kaiku 224 y
  ttr 220; entre 14 y 15 alertas por conjunto.
- **Con otros datos** (por ejemplo, los de la evaluación): súbelos en la app con «Subir kit» y pulsa
  «Entrega · todas las empresas (CSV)», o desde una terminal:

  ```sh
  curl -F archivo=@kit.zip http://<servidor>/api/kit           # devuelve el id del kit
  curl -OJ "http://<servidor>/api/entrega.csv?corrida=kit-<id>"
  ```

La `confianza` es un índice provisional de 0 a 1, no una probabilidad. No se usaron las respuestas
oficiales (`_solucion`, `etiquetas.csv`) para generar ni para ajustar estas alertas.
