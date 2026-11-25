# Miniventa

Variante General de Miniventa: frontend Vue 3, Quasar, Vite y Capacitor 8. Comparte API, cuentas y panel administrativo con la variante de `main`. Requiere Node.js 22.12 o posterior y npm.

## Configuración

1. Instala dependencias con `npm install`.
2. Obtén por un canal confiable la clave pública RSA SPKI del backend, correspondiente a su clave privada offline. Configura `VITE_OFFLINE_PUBLIC_KEY` en `.env.local` como PEM entre comillas, usando `\n` para los saltos de línea, como en `.env.example`. Esta clave es pública y se incorpora a la compilación; no pongas allí la clave privada. No se consulta ningún endpoint para obtenerla. Cada cambio de clave requiere recompilar y distribuir la aplicación.
3. Para Android, configura `VITE_API_URL` con la URL base HTTPS pública del backend, por ejemplo `https://api.ejemplo.com`, sin `/api`. Debe tener un certificado confiable por Android. El backend debe permitir el origen de la WebView Capacitor mediante CORS. No se admiten HTTP, credenciales en la URL, consultas ni fragmentos. Si falta, la aplicación muestra un error de configuración.
4. Ejecuta `npm run dev`. En web, si omites `VITE_API_URL`, `/api` usa el proxy de Vite a `http://localhost:3000`; el proxy no existe en compilaciones estáticas. Configura una URL HTTPS o un proxy inverso de `/api` al desplegar la web.

La aplicación no funciona sin la clave pública configurada. La contraseña nunca se guarda. En la web la sesión vive solo en memoria y se pierde al recargar; la vista previa no ofrece persistencia de credenciales. Android guarda la sesión y el estado de autorización mediante `@aparajita/capacitor-secure-storage` (Android Keystore); si el plugin falla, no se sustituye por almacenamiento inseguro. No se usa la implementación web del plugin, que emplea `localStorage`.

## Acceso y límites offline

Login usa un reto de un solo uso de `POST /api/auth/device-challenge`, firma ECDSA y después `POST /api/auth/login` con nombre de usuario y contraseña; el usuario no tiene que ser un correo. Android crea una clave P-256 por instalación en Android Keystore; la clave privada no es exportable. La aplicación comprueba que la huella incluida en la firma RS256 de la API coincide exactamente con la clave local, además de emisor `miniventa-api`, audiencia `miniventa-offline`, `token_use`, usuario, `iat`, `exp`, fin de suscripción y duración máxima de siete días. La clave RSA de servidor debe tener al menos 2048 bits. Sin una autorización válida no se habilita el espacio de trabajo.

El primer dispositivo se registra al iniciar sesión. Todo dispositivo diferente muestra un folio de solicitud y permanece sin acceso hasta que el administrador lo aprueba. Para ver solicitudes y aprobar una, consulta la sección de gestión manual del README del backend. Después de aprobar, el teléfono anterior pierde acceso online en su siguiente petición; su autorización offline ya emitida puede seguir funcionando localmente hasta vencer, como máximo siete días. Si el usuario reinstala la app o pierde la clave, la nueva instalación se considera otro dispositivo y también necesita aprobación. En navegador la clave solo vive en memoria; ese modo sirve para desarrollo y no representa una identidad persistente de Android.

La renovación `POST /api/auth/renew` usa la sesión Bearer y una prueba ECDSA de posesión de la clave mediante un reto nuevo de un solo uso, al inicio, cada 15 minutos, al recuperar conexión y al volver a primer plano; las solicitudes concurrentes se agrupan y tienen un timeout de 10 segundos. Un `401` exige iniciar sesión de nuevo; un `403` bloquea por suscripción inactiva. Ante fallos de conexión o servidor se permite acceso solo mientras la autorización offline siga siendo válida. Después de 10 fallos consecutivos de conexión se muestra «Es necesario conectarse a internet para estar actualizado» sin bloquear una autorización válida. Una respuesta HTTP interrumpe la racha; errores HTTP y respuestas inválidas no se contabilizan como fallos de red. Un `200` inválido no reemplaza el token anterior; se mantiene el acceso solo mientras dicho token siga siendo válido. El mensaje también aparece tras 10 fallos de conexión consecutivos en login; un `429` indica demasiados intentos.

La aplicación guarda una marca de tiempo máxima en el mismo almacenamiento seguro y, durante la ejecución, compara el avance con el reloj monotónico; un retroceso mayor de dos minutos bloquea el acceso. El vencimiento se revisa periódicamente, al volver a primer plano y antes de modificar registros. Esto no es un reloj de confianza: manipular el reloj antes del primer acceso, reinstalar, restaurar datos, modificar el dispositivo o detener la aplicación puede eludir parte de la protección. No se puede conocer una revocación o cambio de suscripción sin conexión hasta la próxima consulta o el vencimiento. No hay garantía absoluta de siete días en dispositivos comprometidos.

## Datos locales

Productos, clientes y pedidos se guardan por identificador de usuario en SQLite en Android y en IndexedDB en navegador. Los números internos se generan automáticamente y no se solicitan ni muestran para productos y clientes; los importes y totales se calculan como centavos enteros. Los pedidos conservan instantáneas de cliente y productos para que cambios posteriores del catálogo no alteren ventas anteriores. No se solicitan ubicación, rutas ni días de visita. No hay sincronización, recuperación, exportación ni copia de seguridad automática: borrar los datos de la aplicación o del navegador los pierde. SQLite e IndexedDB no están cifrados; la separación por usuario es lógica, no protege de un dispositivo comprometido. Las copias Android y transferencias están deshabilitadas.

Los pedidos se pueden filtrar por cliente. En Android se pueden buscar dispositivos Bluetooth Classic, consultar los emparejados y conectar a impresoras que expongan el perfil serial SPP; el estado aparece en el encabezado. En Android 12 o posterior se necesita el permiso «Dispositivos cercanos» (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`); en Android 11 o anterior se necesita ubicación precisa para escanear. El plugin comprueba el permiso Android real, lo solicita al usar la función y muestra cuál falta. En Android 6 a 11 también puede ser necesario activar Ubicación del sistema para que el escaneo descubra dispositivos. La impresora debe emparejarse desde los ajustes si Android lo solicita. La interfaz web no permite usar este plugin nativo.

Al guardar una nota, la aplicación primero la conserva localmente y, si hay una impresora conectada, envía el ticket ESC/POS. Cada pedido tiene además la acción «Reimprimir ticket». Si falla la impresión, el pedido no se pierde y se muestra el error para volver a intentar. El ticket General incluye CEDIS, número de promotor, folio, fecha, cliente, productos, cantidades e importe total, sin los bloques comerciales de la plantilla original. La salida física depende del modelo de impresora y no está verificada en hardware en este entorno. No hay pagos ni renovación automática de suscripciones.

## Android

El proyecto `android/` incluye plugins nativos `DeviceIdentity` para Android Keystore y `BluetoothPrinter` para búsqueda/conexión Bluetooth Classic SPP. Instala Android Studio, Android SDK 36 y JDK 21. Configura `VITE_API_URL` con una URL HTTPS y `VITE_OFFLINE_PUBLIC_KEY` con la clave pública confiable en `.env.local`; sin ambas, la aplicación no permite iniciar sesión. Para firmar una versión release, crea un keystore Android y configura `android/keystore.properties` siguiendo el formato de `android/keystore.properties.example`. Guarda el keystore y sus contraseñas en un respaldo seguro; perderlos impide firmar futuras actualizaciones compatibles. Nunca los subas al repositorio.

Ejecuta para sincronizar los recursos Android y abrir el proyecto:

```bash
npm run android:sync
npm run android:open
```

Genera la APK firmada para producción con `npm run android:release:apk`, con `JAVA_HOME` y `ANDROID_HOME` configurados. El archivo queda en `android/app/build/outputs/apk/release/app-release.apk`. Compila y prueba desde Android Studio en un dispositivo o emulador Android 7.0 (API 24) o superior. Para validar conexión e impresión se necesita hardware real, una impresora Bluetooth Classic SPP y conceder los permisos solicitados; el emulador no sustituye esa prueba. Gradle Wrapper 8.13 corresponde al Android Gradle Plugin 8.13 usado por este proyecto.

## Pruebas

`npm test` ejecuta pruebas unitarias de JWT, reloj, reintentos, concurrencia, validación, centavos e IndexedDB simulado. `npm run build` comprueba la compilación web. Las pruebas no sustituyen integración real con backend HTTPS y Android.
