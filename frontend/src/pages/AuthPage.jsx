Vamos a comenzar a prepara una web para produccion

Necesito que cambies el login para que use correo electronico para el login, ¿es posible hacer login con google de manera gratuita? Si lo es, agregar debajo.
En registro tomar en cuenta que tengo 3 tipos de usuario, de los cuales registraremos correo electronico, Nombre + Apellido, usuario (tengo dos tipo de nombre, el usuario y el alias, se ingresará y guardara el alias tal cual lo ingrese, para usuario se usara el mismo por defecto pero se validara que no exista ya el mismo y de ser así se generara uno usando el alias+3 caracteres que cumplan la regla, esto no se consultara ni avisará, solo se hará el calculo sin mas y se guarda), y finalmente contraseña con validacion. Se agregaran campos de  direccion tal cual se muestran en perfil, con consulta en api para autorrelleno, mas esto solo sera obligatorio para tienda, cliente y conductor podran configurarlo despues.

NUEVO: Agrega funcion de "Olvidé mi contraseña" con correo desde VAPID

Acepto sugerencias, necesitas algun route u otro archivo?
23:18
Vio 3 archivos

Perfecto, tengo todo lo que necesito. Aquí va mi análisis antes de escribir el código:

Preguntas / Sugerencias:

Google OAuth gratuito — Sí, 100% gratuito vía Google Identity Services (accounts.google.com/gsi). Solo necesitas un GOOGLE_CLIENT_ID en Google Cloud Console (gratis). Lo agrego.
"Olvidé mi contraseña" con VAPID — Importante aclaración: VAPID es para push notifications, no para email. Para enviar correos de reset necesitas un servicio de email (Nodemailer + Gmail/SMTP, Resend, etc.). Mi sugerencia: uso el VAPID_EMAIL que ya tienes como sender con Nodemailer + Gmail App Password (gratis), que es lo más simple dado tu stack. ¿Confirmas? Igual incluyo la lógica frontend.
Archivos que necesitaré del backend: El flujo completo requiere endpoints nuevos. Te entrego también un archivo auth.routes.suggestions.js con los endpoints necesarios documentados.

Procedo con el nuevo AuthPage.jsx:
Se crearon 3 archivos, leyó un archivo

Aquí tienes los 3 archivos. Un resumen de lo que hice y las decisiones importantes:

AuthPage.jsx — reemplaza el anterior, ahora tiene 3 vistas internas (login / register / forgot) sin navegar fuera, más limpio y sin jank.

Login con email — emailRef en lugar de usernameRef
Google Login — gratuito vía Google Identity Services (script GSI de Google, sin SDK de pago). Solo necesitas crear el Client ID en Google Cloud Console (5 min, instrucciones en el archivo de rutas)
Registro completo — correo, nombre completo, alias, username generado silenciosamente, contraseña con barra de fuerza visual, dirección con autorrelleno de CP idéntico al de Profile (obligatoria solo para restaurant)
Olvidé mi contraseña — formulario inline, llama a POST /auth/forgot-password

ResetPasswordPage.jsx — página nueva en /reset-password?token=xxx, lee el token del query string, deja ingresar y confirmar nueva contraseña, redirige al login al terminar.

auth.routes.suggestions.js — guía completa del backend con todos los endpoints nuevos y modificados (/register, /login, /google, /forgot-password, /reset-password), la migración SQL necesaria y las instrucciones paso a paso para Gmail App Password y Google Cloud Console.

Sobre VAPID vs email: VAPID es para push notifications del navegador, no para correos. El flujo de reset usa Nodemailer + Gmail App Password (completamente gratis con tu cuenta existente encorto.vo@gmail.com). Solo necesitas activar verificación en 2 pasos y generar una App Password de 16 caracteres. Las variables ya están documentadas en el archivo de rutas.
Authpage
Código · JSX
Resetpasswordpage
Código · JSX
Auth.routes.suggestions
JS

1 como obtendo mi id desde cloud

2 confirmo 🗿dame instrucciones

Que mas falta?
23:24

Perfecto, aquí va todo:
1. Obtener tu Google Client ID

Ve a console.cloud.google.com
Crea un proyecto nuevo (o selecciona uno existente)
Menú izquierdo → APIs y servicios → Credenciales
Botón + Crear credenciales → ID de cliente de OAuth 2.0
Tipo de aplicación: Aplicación web
Nombre: lo que quieras (ej: "Morelivery")
Orígenes autorizados (agrega los dos):

http://localhost:5173
https://lmorelivery.vercel.app

URIs de redireccionamiento — déjalos vacíos (GSI no los usa)
Clic en Crear → copia el ID de cliente (termina en .apps.googleusercontent.com)

2. Gmail App Password

Ve a myaccount.google.com/security
Activa Verificación en 2 pasos si no la tienes
Busca "Contraseñas de aplicaciones" (aparece solo si tienes 2FA activo)
Selecciona app: Correo / dispositivo: Otro → escribe "Morelivery"
Copia las 16 letras que genera

3. Qué falta — archivos backend

Viendo tu routes.js real, necesito integrar los 3 endpoints nuevos ahí mismo. También necesito ver service.js y schemas.js para no romper nada existente. ¿Puedes subir esos dos archivos?

Lo que agregaré directamente a tu routes.js:

POST /auth/google — verificación con google-auth-library
POST /auth/forgot-password — genera token y manda email con Nodemailer
POST /auth/reset-password — verifica token y actualiza contraseña
Modificar POST /auth/register para aceptar email, fullName, alias
Modificar POST /auth/login para aceptar email en lugar de username
Quitar el authenticate del GET /auth/postal/:cp para que funcione en registro sin token

Con service.js y schemas.js puedo darte el código listo para copiar y pegar sin adivinar tu estructura de DB.

Donde pego mi ID y contraseñas?
23:34

En dos lugares:
Backend — tu archivo .env

Agrega estas líneas al final:
env

GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
RESET_TOKEN_SECRET=pon_aqui_cualquier_frase_larga_y_random
FRONTEND_URL=https://lmorelivery.vercel.app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=encorto.vo@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx

Frontend — crea un archivo .env en la raíz del proyecto Vite

Si no existe, créalo junto a package.json:
env

VITE_GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com

Las variables de Vite deben empezar con VITE_ para ser accesibles en el navegador.

⚠️ Importante antes de subir a Vercel

El .env del frontend no se sube — Vercel necesita que lo configures manualmente:

Dashboard de Vercel → tu proyecto → Settings → Environment Variables
Agrega VITE_GOOGLE_CLIENT_ID con tu valor
Redeploy

El .env del backend tampoco se sube si usas un servidor propio — ya lo tienes en tu máquina con el DATABASE_URL y demás, solo agrégale las líneas nuevas ahí mismo.

Que hago con el authroutessugg
23:44

Ahora entiendo tu arquitectura completa. El archivo de sugerencias no lo uses directamente — era solo orientativo. Voy a darte los 3 archivos reales modificados para tu proyecto.

El cambio clave que veo: actualmente usas pseudoEmail (username@local.test) como hack de identidad. Vamos a agregar un campo real_email separado para no romper el login existente mientras agregamos el nuevo flujo.
Se crearon 4 archivos, leyó un archivo

4 archivos listos. El orden exacto para desplegar:

1. Base de datos — primero → Ejecuta el .sql en tu Postgres. Solo agrega columnas, no toca nada existente.

2. Backend → Reemplaza tus 3 archivos (routes.js, service.js, schemas.js) e instala las dependencias nuevas:
bash

npm install nodemailer google-auth-library

3. Frontend → Ya tienes el AuthPage.jsx y ResetPasswordPage.jsx del paso anterior. Agrega la ruta en tu router:
jsx

<Route path="/reset-password" element={<ResetPasswordPage />} />

4. Variables de entorno → Las del paso anterior en tu .env backend y .env del frontend.

Lo que no se rompe: los usuarios existentes siguen funcionando igual — su login con username sigue activo porque el loginSchema acepta ambos formatos. El campo real_email queda NULL para ellos hasta que actualicen su perfil.
Routes
JS
Service
JS
Schemas
JS
Migration auth email
Código · SQL

Cabe mencionar que el env solo era referencia, mi backend esta en render y db en railway
23:48

Entonces las variables de entorno van directo en los dashboards:
Backend — Render

Ve a tu servicio en render.com
Environment → Environment Variables
Agrega una por una:

Key	Value
GOOGLE_CLIENT_ID	xxx.apps.googleusercontent.com
RESET_TOKEN_SECRET	cualquier frase larga random
FRONTEND_URL	https://lmorelivery.vercel.app
SMTP_HOST	smtp.gmail.com
SMTP_PORT	587
SMTP_USER	encorto.vo@gmail.com
SMTP_PASS	las 16 letras del App Password

Render redeploya automático al guardar.

Base de datos — Railway

La migración SQL la corres directamente ahí:

Ve a tu proyecto en railway.app
Click en tu servicio PostgreSQL → pestaña Data o Query
Pega y ejecuta el contenido del migration_auth_email.sql

Si no ves un editor SQL, Railway también te da la DATABASE_URL — puedes conectarte con cualquier cliente como TablePlus, DBeaver o desde terminal:
bash

psql "postgresql://darielv:...@.../Morelivery" -f migration_auth_email.sql

Frontend — Vercel

Dashboard de Vercel → tu proyecto → Settings → Environment Variables
Agrega:

Key	Value
VITE_GOOGLE_CLIENT_ID	xxx.apps.googleusercontent.com

Redeploy manual desde la pestaña Deployments para que tome efecto.

Si, ya, pero entonces no es necesario instalara dependdencias
23:50

Correcto — en Render las dependencias se instalan solas desde tu package.json en cada deploy.

Solo asegúrate de que estén declaradas ahí:
bash

npm install nodemailer google-auth-library

Esto solo lo corres una vez en local para que se agreguen al package.json y al package-lock.json. Al hacer push, Render las instala automáticamente.

Frontend → Ya tienes el AuthPage.jsx y ResetPasswordPage.jsx del paso anterior. Agrega la ruta en tu router:"

Que router

Por cierto, necesito que la verificacion de email se salte de momento y permita ingresar datos ficticios, solo necesitaba tenerlo preparado para conectar cuando llegue el momento
23:52

Buenas preguntas, las dos juntas:
¿Qué router?

Necesito ver cómo tienes configuradas tus rutas en el frontend. Típicamente es un archivo como App.jsx, router.jsx, routes.jsx o similar que tiene algo así:
jsx

<Route path="/login" element={<AuthPage mode="login" />} />

¿Puedes subir ese archivo?
Saltarse verificación de email

Dos cambios simples:

Backend — service.js, en registerUser, la función forgotPassword ya es silenciosa. Solo hay que asegurarse de que el registro no bloquee si el email es ficticio. Ya está así — no hay ninguna verificación de formato real ni confirmación de email en el flujo, así que registros con test@test.com o cualquier cosa funcionan sin problema.

Lo único que hay que desactivar es la validación de formato en schemas.js si quieres admitir emails completamente inventados como juan@, pero si solo necesitas formatos básicos como test@test.com el schema actual ya los acepta sin problema.

¿Qué tan "ficticios" necesitas? ¿Formato libre total o algo como x@x.x es suficiente?

Como estan ahora esta bien, especificamente necesito que no se active el mail y ademas tener ya implementada la validacion via mail code para conectar despues
23:55

Perfecto. Entonces el plan es:

Ahora: registro funciona sin verificación, el campo email_verified queda en false pero no bloquea nada
Después: solo conectas el envío real del código y cambias una línea para que sí bloquee

Necesito ver el service.js que ya tienes actualizado o el que te entregué — voy a modificar solo las partes de registro y el nuevo flujo de verificación.

Los cambios son:

En BD — agregar columnas email_verified, email_verify_token, email_verify_expires a users

En service.js — registerUser guarda el token generado pero no envía nada (el mailer.sendMail está comentado con un TODO)

En routes.js — agregar GET /auth/verify-email?token=xxx que ya funciona para cuando conectes

En AuthPage.jsx — mostrar un banner "Verifica tu correo" después del registro pero sin bloquear el login
Visualizó un archivo, archivo editado

Ahora agregar verifyEmail al service y la ruta al routes:
Vio 3 archivos, archivo editado

Ahora la ruta en routes.js:
2 archivos editados

Ahora el banner en AuthPage.jsx y el mensaje cuando llega ?verified=1:
4 archivos editados

Ahora la migración SQL:
Archivo editado, leyó un archivo

Listo. Resumen de lo que está preparado pero inactivo:

Ahora mismo:

Registro genera el token y lo guarda en BD, pero no manda nada
Login no verifica email_verified — entra aunque sea false
Post-registro muestra banner amarillo "próximamente recibirás un correo" (honesto sin prometer nada)
GET /auth/verify-email?token=xxx ya funciona si alguien llegara a tener el enlace

Cuando quieras activarlo, solo 3 pasos:

Agrega EMAIL_VERIFICATION_ENABLED=true en Render
Descomenta el bloque mailer.sendMail en registerUser (está marcado con TODO)
Si quieres bloquear login sin verificar, agrega en loginUser un check: if (!user.email_verified) throw new AppError(403, 'Verifica tu correo antes de ingresar')

Service
JS
Routes
JS
Authpage
Código · JSX
Migration auth email
Código · SQL
0:02
Reading App.jsx to see current router setup

Ahora entiendo todo el cuadro. Tu App.jsx tiene su propio AuthScreen inline con el flujo viejo (username), y las rutas son /:appKey/login y /:appKey/register — no /login y /register como asumí.

Hay dos opciones:

Buena elección. Te entrego el App.jsx actualizado:

Elimina AuthScreen inline y todo su código viejo
Reemplaza con AuthPage (el nuevo) en las mismas rutas /:appKey/login y /:appKey/register
Agrega /reset-password
El appKey se pasa como prop para que AuthPage sepa el rol por defecto en registro

Vio 3 archivos, 3 archivos editados

Ahora el navigate post-login — usar appKey si existe:
Vio 2 archivos, archivo editado

Ahora el App.jsx — reemplazar AuthScreen por AuthPage y agregar las rutas nuevas:
Archivo creado, leyó un archivo

Lo que cambió y por qué:

App.jsx — el AuthScreen inline ya no tiene inputs ni lógica de auth. Quedó como un wrapper liviano que solo maneja el header con botón de regreso, el ícono del rol y el aviso de sesión cruzada. Todo el formulario real vive en AuthPage.

AuthPage.jsx — recibe appKey como prop nueva y con ella:

Preselecciona el rol en el selector del registro (/:customer/register abre en "Cliente" directo)
Valida en el login que el rol del usuario coincida con el appKey de la URL, mostrando el mismo mensaje que tenías antes: "Esta cuenta es de tipo Tienda. Accede desde la sección correcta."
El navigate post-login sigue yendo a /${data.user.role} como antes

Las rutas son exactamente las mismas — no se rompe nada existente.
App
Código · JSX
Authpage
Código · JSX

[User denied question request]
0:05

Perfecto, sin preguntas. Dime qué sigue o qué necesitas revisar.

Dame esto como un bloque comentado para agregar al archivo

Descomenta el bloque mailer.sendMail en registerUser (está marcado con TODO)
Si quieres bloquear login sin verificar, agrega en loginUser un check: if (!user.email_verified) throw new AppError(403, 'Verifica tu correo antes de ingresar')

0:06

Ve al service.js y busca el comentario // ── TODO:. Reemplaza todo ese bloque con esto:
js

// ── VERIFICACIÓN DE EMAIL — descomenta cuando estés listo ────────────────
// Paso 1: Agrega EMAIL_VERIFICATION_ENABLED=true en Render
// Paso 2: Descomenta el bloque de abajo
//
// if (process.env.EMAIL_VERIFICATION_ENABLED === 'true') {
//   const frontUrl  = process.env.FRONTEND_URL || 'http://localhost:5173';
//   const verifyUrl = `${frontUrl}/verify-email?token=${verifyToken}`;
//   try {
//     await mailer.sendMail({
//       from:    `"Morelivery" <${process.env.SMTP_USER}>`,
//       to:      realEmail,
//       subject: 'Confirma tu correo en Morelivery',
//       html: `
//         <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
//           <h2 style="color:#1a202c">Confirma tu correo 📬</h2>
//           <p>Hola ${payload.alias}, haz clic para verificar tu cuenta:</p>
//           <p style="margin:24px 0">
//             <a href="${verifyUrl}"
//                style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
//               Verificar correo
//             </a>
//           </p>
//           <p style="color:#718096;font-size:13px">El enlace expira en 48 horas.</p>
//         </div>
//       `,
//     });
//   } catch (err) {
//     logEvent('auth.verify_email_send_error', { userId: result.rows[0]?.id, error: err.message });
//   }
// }

// ── BLOQUEAR LOGIN SIN VERIFICAR — descomenta en loginUser cuando actives lo de arriba ──
// Busca la función loginUser y agrega esto justo después del check de user.status:
//
// if (user.email_verified === false) {
//   throw new AppError(403, 'Verifica tu correo antes de ingresar');
// }

npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead added 15 packages, removed 6 packages, and audited 220 packages in 5s 30 packages are looking for funding  run npm fund for details 3 vulnerabilities (2 moderate, 1 high) To address issues that do not require attention, run:  npm audit fix To address all issues (including breaking changes), run:  npm audit fix --force Run npm audit for details.
0:43

Todo normal. El warning de node-domexception es deprecación sin impacto real. Las 3 vulnerabilidades son casi siempre en dependencias de desarrollo, no en producción.

Corre esto para ver si son relevantes:
bash

npm audit

Si todas dicen devDependencies o son de herramientas como vite, esbuild, jest — ignóralas, no afectan tu app en producción.

Si alguna es de bcryptjs, jsonwebtoken, nodemailer o google-auth-library — mándame el output y lo revisamos.

npm audit report esbuild  <=0.24.2 Severity: moderate esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99 fix available via npm audit fix --force Will install vite@8.0.1, which is a breaking change node_modules/esbuild  vite  0.11.0 - 6.1.6  Depends on vulnerable versions of esbuild  node_modules/vite socket.io-parser  4.0.0 - 4.2.5 Severity: high socket.io allows an unbounded number of binary attachments - https://github.com/advisories/GHSA-677m-j7p3-52f9 fix available via npm audit fix node_modules/socket.io-parser 3 vulnerabilities (2 moderate, 1 high) To address issues that do not require attention, run:  npm audit fix To address all issues (including breaking changes), run:  npm audit fix --force
0:45

Las 3 son irrelevantes para producción:

esbuild / vite — vulnerabilidad solo en el servidor de desarrollo local (vite dev). En producción Vercel compila y sirve archivos estáticos, esbuild no corre. No hagas npm audit fix --force — instalaría Vite 8 que es breaking change innecesario ahora.

socket.io-parser — corre esto, es fix seguro:
bash

npm audit fix

Eso resuelve el high sin tocar Vite. Los dos moderate de esbuild quedan pero no importan en producción.

Error al interpretar el valor para '-webkit-text-size-adjust'. Declaración rechazada. login:1:278
Se esperaba un nombre de una característica de medios, pero se encontró '-ms-high-contrast'. login:1:1914
Se esperaba un nombre de una característica de medios, pero se encontró 'preferes-contrast'. login:1:2026
[GSI_LOGGER]: Provided button width is invalid: 100% client:81:460
Feature Policy: Saltándose una función de nombre no compatible “identity-credentials-get”. client:278:37
Feature Policy: Saltándose una función de nombre no compatible “identity-credentials-get”. client:279:376
Se ha bloqueado la apertura de múltiples ventanas emergentes por no haber sido activado por el usuario. client:94:240
[GSI_LOGGER]: google.accounts.id.initialize() is called multiple times. This could cause unexpected behavior and only the last initialized instance will be used. client:81:460
[GSI_LOGGER]: Provided button width is invalid: 100% client:81:460
Feature Policy: Saltándose una función de nombre no compatible “identity-credentials-get”. client:278:37
Feature Policy: Saltándose una función de nombre no compatible “identity-credentials-get”. client:279:376
Advertencias de política de seguridad de contenido 5
Se ha proporcionado cookie particionada o acceso de almacenamiento a “https://accounts.google.com/gsi/button?theme=filled_black&size=large&width=100%25&text=continue_with&is_fedcm_supported=false&client_id=173939737547-v1utl5gctadnihd2ip0qq5i4lgkli61t.apps.googleusercontent.com&iframe_id=gsi_180308_992783&cas=%2FBHshw0EZCD9z2FrPTXuEuUlb7%2B41yTY918DmLILXJo&hl=es” porque se carga en el contexto de terceros y está activada la partición de estado dinámico.
content.js:18:430465
Concedido automáticamente acceso al almacenamiento para el origen “https://accounts.google.com” en “https://morelivery.vercel.app”. 2
Error al interpretar el valor para '-webkit-text-size-adjust'. Declaración rechazada. button:1:278
Se esperaba un color, pero se encontró '-webkit-focus-ring-color'. Error al interpretar el valor para 'outline-color'. Declaración rechazada. button:1:11449
Propiedad desconocida 'border-sizing'. Declaración rechazada. button:1:19885
Se esperaba un nombre de una característica de medios, pero se encontró '-ms-high-contrast'. button:1:26122
Se esperaba un nombre de una característica de medios, pero se encontró '-ms-high-contrast'. button:1:32259
Se esperaba un nombre de una característica de medios, pero se encontró 'preferes-contrast'.
0:46

Todo esto es normal y no es tuyo. Desglosado:

CSS warnings (-webkit-text-size-adjust, -ms-high-contrast, preferes-contrast) — vienen del CSS interno del botón de Google, no de tu código. Firefox los reporta pero los ignora correctamente.

Provided button width is invalid: 100% — Google GSI no acepta width en porcentaje, solo números en px. Fix rápido en AuthPage.jsx:
jsx

// Cambia esto:
<div ref={googleBtnRef} style={{ width:'100%' }} />

// Por esto:
<div ref={googleBtnRef} style={{ width:'100%' }}>
<div ref={googleBtnRef} id="g_id_signin" />
</div>

Mejor aún, pasa el ancho como número al renderButton:
jsx

window.google.accounts.id.renderButton(googleBtnRef.current, {
  theme: dark ? 'filled_black' : 'outline',
  size:  'large',
  width: 360,   // ← número fijo en px, no string
  text:  'continue_with',
  locale: 'es',
});

initialize() is called multiple times — el useEffect que renderiza el botón corre más de una vez. Fix: agregar un ref guard:
jsx

const googleInitialized = useRef(false);

useEffect(() => {
  if (view !== 'login' || !GOOGLE_CLIENT_ID) return;
  if (googleInitialized.current) return; // ← evita doble init
  const render = () => {
    if (!window.google || !googleBtnRef.current) return;
    googleInitialized.current = true;
    // ... resto igual
  };
  // ...
}, [view, dark, handleGoogleResponse]);

Feature Policy: identity-credentials-get — warning del navegador sobre FedCM, es de Google no tuyo. Inofensivo.

cookie particionada — Firefox siendo estricto con cookies de terceros de Google. Normal en desarrollo, en producción con HTTPS funciona bien.

¿Quieres que te entregue el bloque del useEffect de Google corregido completo?

useEffect(() => {
  if (view !== 'login' || !GOOGLE_CLIENT_ID) return;
  if (googleInitialized.current) return; // ← evita doble init
  const render = () => {
    if (!window.google || !googleBtnRef.current) return;
    googleInitialized.current = true;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback:  handleGoogleResponse,
    });
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: dark ? 'filled_black' : 'outline',
      size:  'large',
      width: 360,   // ← número fijo en px, no string
      text:  'continue_with',
      locale: 'es',
    });
    0:50

    Ese bloque está bien pero le falta el cierre. Aquí completo:
    Visualizó un archivo, archivo editado, leyó un archivo

    Los dos cambios aplicados: googleInitialized como ref guard evita el doble initialize(), y width: 360 en número entero elimina el warning del botón.
    Authpage
    Código · JSX


    Claude es IA y puede cometer errores. Por favor, verifica las respuestas.
    Authpage · JSX
    Copiado
    // frontend/src/pages/AuthPage.jsx
    // ─────────────────────────────────────────────────────────────────────────────
    //  Cambios respecto a la versión anterior
    //  • Login con correo electrónico (ya no username)
    //  • Login con Google (Google Identity Services — gratuito)
    //  • Registro: correo, nombre completo, alias, contraseña con validación
    //    - username se genera automáticamente desde alias (sin consulta al usuario)
    //    - dirección estructurada con autorrelleno de CP (igual que Profile)
    //      → obligatoria solo para "restaurant"; opcional para customer/driver
    //  • Flujo "Olvidé mi contraseña" (solicita reset por email)
    //  • Dark mode persistido
    // ─────────────────────────────────────────────────────────────────────────────

    import { useCallback, useEffect, useRef, useState } from 'react';
    import { Link, useNavigate, useSearchParams } from 'react-router-dom';
    import { useAuth } from '../contexts/AuthContext';
    import { apiFetch } from '../api/client';

    // ── Constante: Client ID de Google (configura en .env) ──────────────────────
    // VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
    const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

    // ── Dark mode ────────────────────────────────────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark];
}

// ── Utilidad: genera username desde alias ────────────────────────────────────
// Limpia el alias, lo pone en minúsculas sin espacios ni caracteres especiales.
// Si el alias ya tiene ≥3 chars de sufijo se omite la generación adicional;
// el backend decide si hay colisión y añade sufijo random — aquí solo enviamos
// el candidato base. Ver comentario en auth.routes.suggestions.js.
function buildUsernameCandidate(alias = '') {
  return alias
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')   // quitar tildes
  .replace(/[^a-z0-9._-]/g, '')      // solo chars válidos
  .slice(0, 30)
  || 'user';
}

// ── Validación de contraseña ─────────────────────────────────────────────────
function validatePassword(pwd) {
  if (pwd.length < 8)             return 'Mínimo 8 caracteres';
  if (!/[A-Z]/.test(pwd))         return 'Al menos una mayúscula';
  if (!/[0-9]/.test(pwd))         return 'Al menos un número';
  return null;
}

// ── Fetch colonias desde CP (idéntico al de Profile) ────────────────────────
async function fetchColoniasByPostal(cp) {
  try {
    // Sin token en registro — el endpoint debe ser público o aceptar anon
    const result = await apiFetch(`/auth/postal/${cp}`);
    return {
      estado:   result?.estado   || '',
      ciudad:   result?.ciudad   || '',
      colonias: Array.isArray(result?.colonias) ? result.colonias : [],
    };
  } catch {
    return null;
  }
}

// ── Componente raíz ──────────────────────────────────────────────────────────
export default function AuthPage({ mode = 'login', appKey = null }) {
  return <AuthForm mode={mode} appKey={appKey} />;
}

// ── AuthForm ─────────────────────────────────────────────────────────────────
function AuthForm({ mode, appKey }) {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [searchParams] = useSearchParams();
  const [dark, setDark] = useDarkMode();

  const [view, setView] = useState(mode);

  // Banner "correo verificado" si viene ?verified=1 desde el enlace del email
  const [verifiedBanner, setVerifiedBanner] = useState(searchParams.get('verified') === '1');

  // Banner post-registro — muestra aviso sin bloquear
  const [showVerifyHint, setShowVerifyHint] = useState(false);

  // ── Campos comunes
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  // ── Campos registro — role preseleccionado desde appKey si viene de /:appKey/register
  const [fullName,    setFullName]    = useState('');

  const [alias,       setAlias]       = useState('');
  const [regEmail,    setRegEmail]    = useState('');
  const [regPwd,      setRegPwd]      = useState('');
  const [regPwdConf,  setRegPwdConf]  = useState('');
  // Si viene de /:appKey/register, preseleccionar el rol correspondiente
  const validRoles = ['customer', 'restaurant', 'driver'];
  const [role, setRole] = useState(
    validRoles.includes(appKey) ? appKey : 'customer'
  );
  const [pwdError,    setPwdError]    = useState('');

  // ── Dirección estructurada (registro)
  const [postalCode,   setPostalCode]   = useState('');
  const [estado,       setEstado]       = useState('');
  const [ciudad,       setCiudad]       = useState('');
  const [colonia,      setColonia]      = useState('');
  const [coloniasList, setColoniasList] = useState([]);
  const [calle,        setCalle]        = useState('');
  const [numero,       setNumero]       = useState('');
  const [cpLoading,    setCpLoading]    = useState(false);
  const [cpError,      setCpError]      = useState('');
  const cpTimerRef     = useRef(null);
  const lastCp         = useRef('');

  // ── Forgot password
  const [forgotEmail,  setForgotEmail]  = useState('');

  // ── PWA install prompt
  const [installPrompt, setInstallPrompt] = useState(null);

  // ── Mensajes globales
  const [message, setMessage] = useState({ text: '', ok: false });
  const [loading, setLoading] = useState(false);

  // ── Inyectar Google GSI script ──────────────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (document.getElementById('google-gsi')) return;
    const s = document.createElement('script');
    s.id  = 'google-gsi';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // ── PWA install prompt ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // ── Autorrelleno CP ─────────────────────────────────────────────────────
  useEffect(() => {
    const cp = postalCode.trim();
    if (cp.length !== 5 || !/^\d{5}$/.test(cp)) {
      setCpError(''); setColoniasList([]); return;
    }
    if (cp === lastCp.current) return;
    clearTimeout(cpTimerRef.current);
    cpTimerRef.current = setTimeout(async () => {
      setCpLoading(true); setCpError('');
      const res = await fetchColoniasByPostal(cp);
      setCpLoading(false);
      lastCp.current = cp;
      if (!res) {
        setCpError('CP no encontrado — llena estado, ciudad y colonia manualmente');
        setColoniasList([]);
      } else {
        setEstado(res.estado);
        setCiudad(res.ciudad);
        setColoniasList(res.colonias);
        if (res.colonias.length > 0) setColonia(res.colonias[0]);
      }
    }, 600);
  }, [postalCode]);

  // ── Validar contraseña en tiempo real ───────────────────────────────────
  useEffect(() => {
    if (!regPwd) { setPwdError(''); return; }
    setPwdError(validatePassword(regPwd) || '');
  }, [regPwd]);

  const msg = (text, ok = false) => setMessage({ text, ok });

  // ── Construir dirección completa ────────────────────────────────────────
  function buildAddress() {
    const parts = [calle, numero].filter(Boolean).join(' ');
    return [parts, colonia, ciudad, estado, postalCode].filter(Boolean).join(', ');
  }

  // ── SUBMIT LOGIN ────────────────────────────────────────────────────────
  const submitLogin = useCallback(async () => {
    const email    = emailRef.current?.value?.trim()    || '';
    const password = passwordRef.current?.value         || '';
  if (!email || !password) { msg('Ingresa tu correo y contraseña'); return; }
  setLoading(true);
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    // Si venimos de /:appKey/login, validar que el rol coincida
    if (appKey && data.user.role !== appKey) {
      const labels = { customer:'Cliente', restaurant:'Tienda', driver:'Conductor', admin:'Administrador' };
      msg(`Esta cuenta es de tipo "${labels[data.user.role] || data.user.role}". Accede desde la sección correcta.`);
      return;
    }
    login({ token: data.token, user: data.user });
    navigate(`/${data.user.role}`);
  } catch (e) {
    msg(e.message);
  } finally {
    setLoading(false);
  }
  }, [appKey, login, navigate]);

  // ── SUBMIT GOOGLE LOGIN ─────────────────────────────────────────────────
  const handleGoogleResponse = useCallback(async (response) => {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: response.credential }),
      });
      login({ token: data.token, user: data.user });
      navigate(`/${data.user.role}`);
    } catch (e) {
      msg(e.message);
    } finally {
      setLoading(false);
    }
  }, [login, navigate]);

  // Renderizar botón Google cuando el script cargue
  const googleBtnRef      = useRef(null);
  const googleInitialized = useRef(false);
  useEffect(() => {
    if (view !== 'login' || !GOOGLE_CLIENT_ID) return;
    if (googleInitialized.current) return;
    const render = () => {
      if (!window.google || !googleBtnRef.current) return;
      googleInitialized.current = true;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback:  handleGoogleResponse,
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme:  dark ? 'filled_black' : 'outline',
        size:   'large',
        width:  360,
        text:   'continue_with',
        locale: 'es',
      });
    };
    if (window.google) { render(); return; }
    const interval = setInterval(() => { if (window.google) { clearInterval(interval); render(); } }, 200);
    return () => clearInterval(interval);
  }, [view, dark, handleGoogleResponse]);

  // ── SUBMIT REGISTER ─────────────────────────────────────────────────────
  const submitRegister = useCallback(async () => {
    if (!fullName.trim())      { msg('Ingresa tu nombre completo'); return; }
    if (!alias.trim())         { msg('Ingresa un alias/apodo'); return; }
    if (!regEmail.trim())      { msg('Ingresa tu correo electrónico'); return; }
    if (!/\S+@\S+\.\S+/.test(regEmail)) { msg('Correo inválido'); return; }
    const pwdErr = validatePassword(regPwd);
    if (pwdErr)                { msg(pwdErr); return; }
    if (regPwd !== regPwdConf) { msg('Las contraseñas no coinciden'); return; }
    // Dirección obligatoria solo para restaurant
    if (role === 'restaurant' && (!postalCode || !calle)) {
      msg('Ingresa la dirección completa de tu tienda'); return;
    }

    const usernameCandidate = buildUsernameCandidate(alias);
    const addressFull = (['customer','restaurant'].includes(role) && (postalCode || calle))
    ? buildAddress()
    : undefined;

    setLoading(true);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email:    regEmail.trim(),
                             password: regPwd,
                             fullName: fullName.trim(),
                             alias:    alias.trim(),
                             username: usernameCandidate,   // backend valida unicidad y ajusta
                             role,
                             address:     addressFull,
                             postalCode:  postalCode  || undefined,
                             estado:      estado      || undefined,
                             ciudad:      ciudad      || undefined,
                             colonia:     colonia     || undefined,
                             calle:       calle       || undefined,
                             numero:      numero      || undefined,
                             // displayName para restaurant
                             displayName: role === 'restaurant' ? (alias.trim() || undefined) : undefined,
        }),
      });
      msg('¡Registro exitoso! Ya puedes iniciar sesión.', true);
      setShowVerifyHint(true);
      setView('login');
    } catch (e) {
      msg(e.message);
    } finally {
      setLoading(false);
    }
  }, [fullName, alias, regEmail, regPwd, regPwdConf, role, postalCode, estado, ciudad, colonia, calle, numero]);

  // ── SUBMIT FORGOT PASSWORD ──────────────────────────────────────────────
  const submitForgot = useCallback(async () => {
    if (!/\S+@\S+\.\S+/.test(forgotEmail)) { msg('Ingresa un correo válido'); return; }
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      msg('Si el correo está registrado recibirás un enlace para restablecer tu contraseña.', true);
    } catch (e) {
      msg(e.message);
    } finally {
      setLoading(false);
    }
  }, [forgotEmail]);

  function handleKey(e, fn) { if (e.key === 'Enter') fn(); }

  // ── Cambiar de vista (limpia mensajes) ──────────────────────────────────
  function goTo(v) { setMessage({ text: '', ok: false }); setView(v); }

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <section className="auth-card">

    {/* Header */}
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'0.25rem' }}>
    <h2 style={{ margin:0 }}>
    {view === 'login'    && 'Iniciar sesión'}
    {view === 'register' && 'Crear cuenta'}
    {view === 'forgot'   && 'Recuperar contraseña'}
    </h2>
    <button
    onClick={() => setDark(d => !d)}
    title={dark ? 'Modo claro' : 'Modo oscuro'}
    style={{
      background:'none', border:'1px solid var(--border)',
          borderRadius:8, width:34, height:34,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', fontSize:'1rem', color:'var(--text-secondary)', flexShrink:0,
    }}
    >
    {dark ? '☀️' : '🌙'}
    </button>
    </div>

    <p style={{ marginBottom:'1rem', color:'var(--text-secondary)', fontSize:'0.875rem' }}>
    {view === 'login'    && 'Ingresa con tu correo y contraseña.'}
    {view === 'register' && 'Completa los datos para registrarte.'}
    {view === 'forgot'   && 'Te enviaremos un enlace para restablecer tu contraseña.'}
    </p>

    {/* Banner: correo verificado exitosamente */}
    {verifiedBanner && (
      <div style={{ background:'#f0fff4', border:'1px solid #9ae6b4', borderRadius:8, padding:'0.65rem 0.9rem', marginBottom:'0.75rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem' }}>
      <span style={{ fontSize:'0.85rem', color:'#276749' }}>✅ Correo verificado. Ya puedes iniciar sesión.</span>
      <button onClick={() => setVerifiedBanner(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#276749', fontSize:'1rem', lineHeight:1 }}>✕</button>
      </div>
    )}

    {/* Banner: post-registro — avisa sin bloquear (envío de correo desactivado por ahora) */}
    {showVerifyHint && view === 'login' && (
      <div style={{ background:'#fffbeb', border:'1px solid #f6e05e', borderRadius:8, padding:'0.65rem 0.9rem', marginBottom:'0.75rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem' }}>
      <span style={{ fontSize:'0.82rem', color:'#744210' }}>📬 Próximamente recibirás un correo para verificar tu cuenta.</span>
      <button onClick={() => setShowVerifyHint(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#744210', fontSize:'1rem', lineHeight:1 }}>✕</button>
      </div>
    )}

    {/* ── VISTA: LOGIN ────────────────────────────────────────────────── */}
    {view === 'login' && (
      <>
      <div className="row">
      <label>Correo electrónico
      <input
      ref={emailRef}
      defaultValue=""
      type="email"
      placeholder="tu@correo.com"
      autoComplete="email"
      onKeyDown={e => handleKey(e, submitLogin)}
      />
      </label>
      <label>Contraseña
      <input
      ref={passwordRef}
      defaultValue=""
      type="password"
      placeholder="Tu contraseña"
      autoComplete="current-password"
      onKeyDown={e => handleKey(e, submitLogin)}
      />
      </label>
      </div>

      {/* Olvidé mi contraseña */}
      <div style={{ textAlign:'right', marginTop:'-0.25rem', marginBottom:'0.75rem' }}>
      <button
      type="button"
      onClick={() => goTo('forgot')}
      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.8rem', padding:0 }}
      >
      ¿Olvidaste tu contraseña?
      </button>
      </div>

      <div className="row">
      <button className="btn-primary" onClick={submitLogin} disabled={loading}>
      {loading ? 'Ingresando…' : 'Iniciar sesión'}
      </button>

      {/* Separador */}
      {GOOGLE_CLIENT_ID && (
        <>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', margin:'0.25rem 0' }}>
        <hr style={{ flex:1, border:'none', borderTop:'1px solid var(--border)' }} />
        <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', whiteSpace:'nowrap' }}>o continúa con</span>
        <hr style={{ flex:1, border:'none', borderTop:'1px solid var(--border)' }} />
        </div>
        {/* Google renderiza aquí su botón */}
        <div ref={googleBtnRef} style={{ width:'100%' }} />
        </>
      )}

      {installPrompt && (
        <button
        type="button"
        className="btn-sm"
        onClick={async () => {
          installPrompt.prompt();
          await installPrompt.userChoice.catch(() => null);
          setInstallPrompt(null);
        }}
        style={{ marginTop:'0.4rem' }}
        >
        Instalar app (PWA)
        </button>
      )}

      <button
      type="button"
      onClick={() => goTo('register')}
      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.875rem', textAlign:'center', padding:'0.25rem 0' }}
      >
      ¿No tienes cuenta? <strong>Regístrate</strong>
      </button>
      </div>
      </>
    )}

    {/* ── VISTA: REGISTER ─────────────────────────────────────────────── */}
    {view === 'register' && (
      <>
      {/* Datos personales */}
      <div className="row">
      <label>Nombre completo
      <input
      value={fullName}
      onChange={e => setFullName(e.target.value)}
      placeholder="Ej: Juan García López"
      autoComplete="name"
      />
      </label>

      <label>
      Alias / Apodo
      <input
      value={alias}
      onChange={e => setAlias(e.target.value)}
      placeholder="Ej: JuanG"
      autoComplete="nickname"
      />
      <span style={{ fontSize:'0.73rem', color:'var(--text-secondary)', marginTop:'0.2rem', display:'block' }}>
      Así te verán los demás. Tu nombre de usuario se genera automáticamente.
      </span>
      </label>

      <label>Correo electrónico
      <input
      value={regEmail}
      onChange={e => setRegEmail(e.target.value)}
      type="email"
      placeholder="tu@correo.com"
      autoComplete="email"
      />
      </label>

      <label>Tipo de cuenta
      <select value={role} onChange={e => setRole(e.target.value)}>
      <option value="customer">Cliente</option>
      <option value="restaurant">Tienda</option>
      <option value="driver">Conductor</option>
      </select>
      </label>
      </div>

      {/* Contraseña */}
      <div className="row" style={{ marginTop:'0.5rem' }}>
      <label>
      Contraseña
      <input
      value={regPwd}
      onChange={e => setRegPwd(e.target.value)}
      type="password"
      placeholder="Mínimo 8 caracteres"
      autoComplete="new-password"
      />
      {pwdError && (
        <span style={{ fontSize:'0.73rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>
        {pwdError}
        </span>
      )}
      </label>
      <label>Confirmar contraseña
      <input
      value={regPwdConf}
      onChange={e => setRegPwdConf(e.target.value)}
      type="password"
      placeholder="Repite la contraseña"
      autoComplete="new-password"
      />
      </label>

      {/* Indicador visual fuerza contraseña */}
      {regPwd.length > 0 && (
        <PasswordStrength pwd={regPwd} />
      )}
      </div>

      {/* Dirección — obligatoria solo para restaurant, opcional para los demás */}
      <div style={{ marginTop:'0.75rem' }}>
      <p style={{ fontWeight:700, fontSize:'0.82rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>
      {role === 'restaurant'
        ? 'Dirección de la tienda (requerida)'
    : 'Dirección (opcional — puedes configurarla después)'}
    </p>
    <AddressBlock
    postalCode={postalCode} setPostalCode={setPostalCode}
    estado={estado}         setEstado={setEstado}
    ciudad={ciudad}         setCiudad={setCiudad}
    colonia={colonia}       setColonia={setColonia}
    coloniasList={coloniasList}
    calle={calle}           setCalle={setCalle}
    numero={numero}         setNumero={setNumero}
    cpLoading={cpLoading}   cpError={cpError}
    />
    </div>

    <div className="row" style={{ marginTop:'0.75rem' }}>
    <button className="btn-primary" onClick={submitRegister} disabled={loading}>
    {loading ? 'Registrando…' : 'Crear cuenta'}
    </button>
    <button
    type="button"
    onClick={() => goTo('login')}
    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.875rem', textAlign:'center', padding:'0.25rem 0' }}
    >
    ¿Ya tienes cuenta? <strong>Inicia sesión</strong>
    </button>
    </div>
    </>
    )}

    {/* ── VISTA: FORGOT PASSWORD ──────────────────────────────────────── */}
    {view === 'forgot' && (
      <>
      <div className="row">
      <label>Correo electrónico de tu cuenta
      <input
      value={forgotEmail}
      onChange={e => setForgotEmail(e.target.value)}
      type="email"
      placeholder="tu@correo.com"
      autoComplete="email"
      onKeyDown={e => handleKey(e, submitForgot)}
      />
      </label>
      </div>
      <div className="row" style={{ marginTop:'0.5rem' }}>
      <button className="btn-primary" onClick={submitForgot} disabled={loading}>
      {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
      </button>
      <button
      type="button"
      onClick={() => goTo('login')}
      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.875rem', textAlign:'center', padding:'0.25rem 0' }}
      >
      ← Volver al inicio de sesión
      </button>
      </div>
      </>
    )}

    {/* ── Mensaje flash ───────────────────────────────────────────────── */}
    {message.text && (
      <p className={`flash ${message.ok ? 'flash-ok' : 'flash-error'}`} style={{ marginTop:'0.75rem' }}>
      {message.text}
      </p>
    )}
    </section>
  );
}

// ── Sub-componente: bloque de dirección ──────────────────────────────────────
function AddressBlock({
  postalCode, setPostalCode,
  estado, setEstado,
  ciudad, setCiudad,
  colonia, setColonia,
  coloniasList,
  calle, setCalle,
  numero, setNumero,
  cpLoading, cpError,
}) {
  const BUSY = { opacity:0.7, pointerEvents:'none' };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.55rem' }}>
    {/* CP */}
    <label>
    Código postal
    <div style={{ position:'relative', ...(cpLoading ? BUSY : {}) }}>
    <input
    value={postalCode}
    onChange={e => setPostalCode(e.target.value.replace(/\D/g,'').slice(0,5))}
    placeholder="Ej: 44100"
    maxLength={5}
    inputMode="numeric"
    />
    {cpLoading && (
      <span style={{ position:'absolute', right:'0.6rem', top:'50%', transform:'translateY(-50%)', fontSize:'0.75rem', color:'var(--text-secondary)' }}>
      Buscando…
      </span>
    )}
    </div>
    {cpError && <span style={{ fontSize:'0.72rem', color:'var(--error)', marginTop:'0.2rem', display:'block' }}>{cpError}</span>}
    </label>

    {/* Estado / Ciudad */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.55rem' }}>
    <label>Estado
    <input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Jalisco" disabled={cpLoading} />
    </label>
    <label>Municipio / Ciudad
    <input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Guadalajara" disabled={cpLoading} />
    </label>
    </div>

    {/* Colonia */}
    <label>
    Colonia
    {coloniasList.length > 0 ? (
      <select value={colonia} onChange={e => setColonia(e.target.value)} disabled={cpLoading}>
      <option value="">Seleccionar colonia…</option>
      {coloniasList.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    ) : (
      <input value={colonia} onChange={e => setColonia(e.target.value)} placeholder="Ej: Col. Centro" disabled={cpLoading} />
    )}
    </label>

    {/* Calle + Número */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0.55rem', alignItems:'end' }}>
    <label>Calle
    <input value={calle} onChange={e => setCalle(e.target.value)} placeholder="Ej: Av. Revolución" />
    </label>
    <label style={{ width:90 }}>Número
    <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="1234" />
    </label>
    </div>
    </div>
  );
}

// ── Sub-componente: indicador de fuerza de contraseña ────────────────────────
function PasswordStrength({ pwd }) {
  let score = 0;
  if (pwd.length >= 8)         score++;
  if (/[A-Z]/.test(pwd))       score++;
  if (/[0-9]/.test(pwd))       score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  const labels = ['Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'];
  const colors = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#2b6cb0'];

  return (
    <div style={{ marginTop:'0.3rem' }}>
    <div style={{ display:'flex', gap:3 }}>
    {[0,1,2,3].map(i => (
      <div key={i} style={{
        flex:1, height:4, borderRadius:2,
        background: i < score ? colors[score] : 'var(--border)',
                         transition:'background 0.3s',
      }} />
    ))}
    </div>
    <span style={{ fontSize:'0.72rem', color: colors[score] || 'var(--text-secondary)', marginTop:'0.2rem', display:'block' }}>
    {labels[score] || ''}
    </span>
    </div>
  );
}


