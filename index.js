const express = require('express');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.use(express.json());
app.use(cors());

// Servir la carpeta "public" donde estará nuestro Frontend bonito
app.use(express.static(path.join(__dirname, 'public')));

// --- CONEXIÓN A POSTGRESQL ---
const pgPool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'hotel_proyecto_final',
    password: '1234',
    port: 5432,
});

// --- CONEXIÓN A MONGODB ---
mongoose.connect('mongodb+srv://Churuz:parajugarmc42@cluster0.dg3vtgq.mongodb.net/hotel_proyecto_mongo')
    .then(() => console.log('Conectado a MongoDB'))
    .catch(err => console.error('Error conectando a Mongo:', err));

// --- ENDPOINT: REPORTE GERENCIAL DE POSTGRESQL ---
app.get('/api/reportes/ocupacion', async (req, res) => {
    try {
        const resultado = await pgPool.query('SELECT * FROM mv_ocupacion_mensual');
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: VISTA DE HABITACIONES DISPONIBLES ---
app.get('/api/habitaciones/disponibles', async (req, res) => {
    try {
        const resultado = await pgPool.query('SELECT * FROM vista_disponibilidad_inmediata');
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: REPORTE MONGODB (PIPELINE AGGREGATION) ---
app.get('/api/reportes/aspectos-mejorables', async (req, res) => {
    try {
        // 1. Definimos el esquema flexible para leer la colección
        const resenaSchema = new mongoose.Schema({}, { strict: false });
        // Evitamos sobreescribir el modelo si ya existe en memoria
        const Resena = mongoose.models.resenas || mongoose.model('resenas', resenaSchema);

        // 2. Construimos el Pipeline de Agregación (Igual que en mongosh)
        const pipeline = [
            { $unwind: "$aspectos_mejorables" },
            { $group: { _id: { $toLower: "$aspectos_mejorables" }, cantidad_menciones: { $sum: 1 } } },
            { $sort: { cantidad_menciones: -1 } }
        ];

        // 3. Ejecutamos y enviamos al frontend
        const resultado = await Resena.aggregate(pipeline);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: LISTA DE HUÉSPEDES (POR NOMBRE) ---
app.get('/api/huespedes', async (req, res) => {
    try {
        const resultado = await pgPool.query('SELECT id_huesped, nombre_completo, documento_identidad FROM huespedes ORDER BY nombre_completo');
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: CREAR NUEVA RESERVA (POSTGRESQL STORED PROCEDURE) ---
app.post('/api/reservas', async (req, res) => {
    // Recibimos los datos del formulario del frontend
    const { id_huesped, id_habitacion, fecha_checkin, fecha_checkout, cantidad_personas } = req.body;
    
    try {
        // Ejecutamos la transacción ACID de PostgreSQL
        await pgPool.query(
            'CALL crear_reserva_hotel($1, $2, $3, $4, $5)', 
            [id_huesped, id_habitacion, fecha_checkin, fecha_checkout, cantidad_personas]
        );
        res.status(201).json({ exito: true, mensaje: 'Reserva creada con éxito. Transacción completada.' });
    } catch (error) {
        // Si PostgreSQL detecta un error (ej. fechas inválidas), lo mandamos al frontend
        res.status(400).json({ exito: false, error: error.message });
    }
});

// --- ENDPOINT: CREAR NUEVO HUÉSPED (POSTGRESQL + MONGODB) ---
app.post('/api/huespedes', async (req, res) => {
    const { nombre_completo, documento_identidad, email, telefono, tipo_almohada, alergias, idiomas } = req.body;
    
    try {
        // 1. Guardar datos rígidos y financieros en PostgreSQL
        const pgResult = await pgPool.query(
            'INSERT INTO huespedes (documento_identidad, nombre_completo, email, telefono) VALUES ($1, $2, $3, $4) RETURNING id_huesped',
            [documento_identidad, nombre_completo, email, telefono]
        );
        const nuevoIdPg = pgResult.rows[0].id_huesped; // Obtenemos el ID generado

        // 2. Normalizar datos flexibles con JavaScript (Requisito del proyecto)
        const alergiasLimpio = alergias ? alergias.split(',').map(a => a.trim().toLowerCase()) : [];
        const idiomasLimpio = idiomas ? idiomas.split(',').map(i => i.trim().toLowerCase()) : [];

        const perfilMongo = {
            id_huesped_pg: nuevoIdPg, // El hilo invisible que conecta Mongo con Postgres
            preferencias_habitacion: { tipo_almohada: tipo_almohada },
            restricciones_alimentarias: alergiasLimpio,
            idiomas: idiomasLimpio
        };

        // 3. Guardar el documento JSON flexible en MongoDB
        const Perfil = mongoose.models.perfiles_huespedes || mongoose.model('perfiles_huespedes', new mongoose.Schema({}, { strict: false }));
        await new Perfil(perfilMongo).save();

        res.status(201).json({ exito: true, mensaje: `Huésped registrado con éxito. Postgres ID: ${nuevoIdPg}` });
    } catch (error) {
        res.status(400).json({ exito: false, error: error.message });
    }
});

// --- ENDPOINT: MONGODB ADVANCED PIPELINE CON $FACET (Obligatorio en rúbrica) ---
app.get('/api/reportes/mongo-inteligente', async (req, res) => {
    try {
        const Resena = mongoose.models.resenas || mongoose.model('resenas', new mongoose.Schema({}, { strict: false }));
        
        // Uso de $facet para procesar múltiples reportes en una sola pasada
        const pipeline = [
            {
                $facet: {
                    "top_aspectos_mejorables": [
                        { $unwind: "$aspectos_mejorables" },
                        { $group: { _id: { $toLower: "$aspectos_mejorables" }, total: { $sum: 1 } } },
                        { $sort: { total: -1 } },
                        { $limit: 5 }
                    ],
                    "analisis_satisfaccion": [
                        { $group: { 
                            _id: "Promedios Generales", 
                            promedio_limpieza: { $avg: "$calificacion.limpieza" },
                            promedio_atencion: { $avg: "$calificacion.atencion" }
                        }}
                    ],
                    "total_resenas": [
                        { $count: "cantidad_absoluta" }
                    ]
                }
            }
        ];

        const resultado = await Resena.aggregate(pipeline);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: OBTENER RESERVAS ACTIVAS PARA CHECK-OUT ---
app.get('/api/reservas/activas', async (req, res) => {
    try {
        const resultado = await pgPool.query(`
            SELECT r.id_reserva, h.nombre_completo, h.documento_identidad, r.total_estimado 
            FROM reservas r 
            JOIN huespedes h ON r.id_huesped = h.id_huesped 
            WHERE r.estado IN ('confirmada', 'en curso')
        `);
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: EJECUTAR CHECK-OUT (OC-02) ---
app.post('/api/checkout', async (req, res) => {
    const { id_reserva, metodo_pago } = req.body;
    try {
        await pgPool.query('CALL checkout_reserva($1, $2)', [id_reserva, metodo_pago]);
        res.json({ exito: true, mensaje: 'Transacción ACID exitosa: Check-out completado, factura cerrada y habitación en limpieza.' });
    } catch (error) {
        res.status(400).json({ exito: false, error: error.message });
    }
});

// --- ENDPOINT: REPORTE POSTGRES (VISTA MATERIALIZADA O FUNCIÓN POR PLAZOS) ---
app.get('/api/reportes/ocupacion', async (req, res) => {
    const { inicio, fin } = req.query; // Atrapamos las fechas de la URL
    try {
        let resultado;
        if (inicio && fin) {
            // Si el usuario puso fechas, usamos la FUNCIÓN que retorna TABLE (Requisito Rúbrica)
            resultado = await pgPool.query('SELECT * FROM reporte_ingresos_por_plazo($1, $2)', [inicio, fin]);
        } else {
            // Si no hay fechas, usamos la VISTA MATERIALIZADA global (Requisito Rúbrica)
            resultado = await pgPool.query('SELECT * FROM mv_ocupacion_mensual');
        }
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: REPORTE MONGODB INTELIGENTE CON FILTRO DE FECHAS ---
app.get('/api/reportes/mongo-inteligente', async (req, res) => {
    const { inicio, fin } = req.query;
    try {
        const Resena = mongoose.models.resenas || mongoose.model('resenas', new mongoose.Schema({}, { strict: false }));
        
        // 1. Etapa de Filtro Dinámico (Match)
        let matchStage = { $match: {} };
        if (inicio && fin) {
            // Convierte los strings a formato ISO Date para Mongo
            matchStage = { 
                $match: { fecha_resena: { $gte: new Date(inicio), $lte: new Date(fin) } } 
            };
        }

        // 2. Pipeline con $facet (Requisito Rúbrica)
        const pipeline = [
            matchStage, // Primero filtramos por fecha
            {
                $facet: {
                    "top_aspectos_mejorables": [
                        { $unwind: "$aspectos_mejorables" },
                        { $group: { _id: { $toLower: "$aspectos_mejorables" }, total: { $sum: 1 } } },
                        { $sort: { total: -1 } },
                        { $limit: 5 }
                    ],
                    "analisis_satisfaccion": [
                        { $group: { 
                            _id: "Promedios Generales", 
                            promedio_limpieza: { $avg: "$calificacion.limpieza" },
                            promedio_atencion: { $avg: "$calificacion.atencion" }
                        }}
                    ]
                }
            }
        ];

        const resultado = await Resena.aggregate(pipeline);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: GENERAR BACKUP FULL EN VIVO ---
app.post('/api/backup', (req, res) => {
    // 1. Inyectamos la contraseña de PostgreSQL temporalmente para que el comando no se quede trabado pidiéndola
    const env = { ...process.env, PGPASSWORD: '1234' }; // ⚠️ CAMBIA '1234' POR TU CONTRASEÑA REAL DE POSTGRES

    // 2. El comando que Node.js escribirá en tu terminal. 
    // Guardará el archivo "backup_hotel.dump" en la misma carpeta de tu proyecto.
    const comando = `"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump" -U postgres -h localhost -p 5432 -d hotel_proyecto_final -F c -f backup_hotel.dump`;
    // 3. Ejecutar el comando en el sistema operativo
    exec(comando, { env }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error ejecutando backup: ${error.message}`);
            return res.status(500).json({ 
                exito: false, 
                error: 'Fallo al hacer backup. Asegúrate de que "pg_dump" esté en las variables de entorno de tu Windows.' 
            });
        }
        res.json({ exito: true, mensaje: '¡Backup Full generado exitosamente y guardado de forma segura!' });
    });
});

// --- LEVANTAR EL SERVIDOR ---
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sistema del Hotel corriendo en: http://localhost:${PORT}`);
});