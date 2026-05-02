# Integracion de runtime Formly

## Rol de cada pieza

- `formly-form-viewer-material`: renderiza el formulario
- `formly-form-utils`: lee catalogo, guarda local y sincroniza
- `form-builder-server`: valida tokens y persiste respuestas

## Contrato recomendado

```ts
FormlyUtilsModule.forRoot({
  pouchDB: {
    localAnswersStoreName: 'host-answers',
    localFormsCatalogStoreName: 'host-catalog',
  },
  bff: {
    apiBaseUrl: 'http://localhost:3000',
    publicCatalogPath: '/formly-form/public/catalog',
    publicFormsPath: '/formly-form/public/forms',
    publicAnswersPath: '/formly-form/public/answers',
    catalogAccessToken: 'replace-with-issued-catalog-token',
  },
  auth: {
    authStrategy: 'none',
    requestCredentialsPolicy: 'omit',
  },
})
```

## Nota

`mongoDB` y `db-config` ya no son contrato publico de esta libreria.
