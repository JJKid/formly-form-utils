# formly-form-utils

Libreria Angular para leer catalogo publico, guardar respuestas localmente y sincronizarlas con el backend.

## Responsabilidad

- leer catalogo publico protegido
- abrir formularios publicados por enlace firmado
- cachear catalogo o formularios si aplica
- guardar respuestas en PouchDB local
- sincronizar respuestas con el backend
- exponer estado observable de catalogo y sincronizacion

## Contrato que inyecta la app host

```ts
FormlyUtilsModule.forRoot({
  pouchDB: {
    localAnswersStoreName: 'buzon-puma-answers',
    localFormsCatalogStoreName: 'buzon-puma-forms-catalog',
  },
  bff: {
    apiBaseUrl: 'http://localhost:3000',
    publicCatalogPath: '/formly-form/public/catalog',
    publicFormsPath: '/formly-form/public/forms',
    publicAnswersPath: '/formly-form/public/answers',
    catalogAccessToken: 'TOKEN_DEL_CATALOGO',
  },
  auth: {
    authStrategy: 'none',
    requestCredentialsPolicy: 'omit',
  },
})
```

## Flujo publico actual

1. la app host pide el catalogo con `catalogAccessToken`
2. el backend devuelve formularios publicados y visibles
3. cada item trae un `publicUrl`
4. el usuario abre el enlace firmado
5. la libreria usa `accessToken` para pedir el formulario
6. guarda respuestas localmente
7. sincroniza respuestas via `POST /formly-form/public/answers`

## Endpoints esperados

- `GET /formly-form/public/catalog`
- `GET /formly-form/public/forms/:id`
- `POST /formly-form/public/answers`

## Lo que esta libreria ya no necesita

- credenciales de CouchDB
- URL directa de CouchDB
- credenciales de MongoDB
- contratos `mongoDB` o `db-config` del modelo anterior
