Requisitos Previos (Prerequisites)
Para ejecutar este sistema en un entorno local o de desarrollo, asegúrese de contar con el siguiente software instalado:

Node.js (v18.0 o superior)

PostgreSQL (v14.0 o superior)

MongoDB (v6.0 local o cuenta activa en MongoDB Atlas)

pgAdmin 4 y MongoDB Compass (Recomendados para administración)

Paso 1: Configuración de la Base de Datos PostgreSQL
Abra pgAdmin y cree una nueva base de datos llamada hotel_proyecto_final.

Abra el Query Tool y ejecute el script SQL principal proporcionado con el proyecto (el cual contiene la creación de tablas, vistas, funciones, procedimientos almacenados y la carga masiva de datos de prueba).

Asegúrese de que el usuario de su base de datos local tenga permisos para realizar operaciones de escritura.

Paso 2: Configuración de la Base de Datos MongoDB
Si utiliza MongoDB Atlas, asegúrese de tener la cadena de conexión (URI) generada.

Reemplace <password> con la contraseña de su usuario de base de datos.

El sistema creará automáticamente la base de datos hotel_proyecto_mongo y sus colecciones respectivas al realizar la primera inserción de datos a través de la API.

Paso 3: Instalación de Dependencias del Servidor
Abra la terminal y navegue hasta el directorio raíz del proyecto (hotel_app).

Ejecute el siguiente comando para instalar las librerías necesarias (Express, pg, Mongoose):

Bash
npm install
Paso 4: Configuración y Ejecución
Abra el archivo index.js en su editor de código.

Modifique las credenciales de conexión de PostgreSQL en la constante pgPool (líneas 15-21) para que coincidan con su usuario local (típicamente postgres y su contraseña respectiva).

Modifique la cadena de conexión de MongoDB en la línea de mongoose.connect().

Levante el servidor ejecutando:

node index.js
Si las conexiones son exitosas, la consola mostrará:

🚀 Sistema del Hotel corriendo en: http://localhost:3000

✅ Conectado a MongoDB

Abra Google Chrome o cualquier navegador moderno y acceda a http://localhost:3000 para operar el sistema.
