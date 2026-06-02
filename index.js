const express = require('express');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.use(express.json());
app.use(cors());

// Servir la carpeta "public" donde estará nuestro Frontend
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

// =====================================================================
// 1. FUNCIÓN JAVASCRIPT REUTILIZABLE (REQUISITO MONGODB - ALERTA 4)
// =====================================================================
function normalizarDatosMongo(alergias, idiomas) {
    const limpiarArray = (str) => {
        if (!str) return [];
        return str.split(',').map(item => item.trim().toLowerCase()).filter(item => item.length > 0);
    };
    return {
        restricciones_alimentarias: limpiarArray(alergias),
        idiomas_hablados: limpiarArray(idiomas)
    };
}

// --- ENDPOINT: VISTA DE HABITACIONES DISPONIBLES ---
app.get('/api/habitaciones/disponibles', async (req, res) => {
    try {
        const resultado = await pgPool.query('SELECT * FROM vista_disponibilidad_inmediata');
        res.json(resultado.rows);
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

// --- ENDPOINT: CREAR NUEVA RESERVA (OC-01) ---
app.post('/api/reservas', async (req, res) => {
    const { id_huesped, id_habitacion, fecha_checkin, fecha_checkout, cantidad_personas } = req.body;
    try {
        await pgPool.query(
            'CALL crear_reserva_hotel($1, $2, $3, $4, $5)', 
            [id_huesped, id_habitacion, fecha_checkin, fecha_checkout, cantidad_personas]
        );
        res.status(201).json({ exito: true, mensaje: 'Reserva creada con éxito. Transacción completada.' });
    } catch (error) {
        res.status(400).json({ exito: false, error: error.message });
    }
});

// --- ENDPOINT: CREAR NUEVO HUÉSPED (POSTGRESQL + MONGODB) ---
app.post('/api/huespedes', async (req, res) => {
    const { nombre_completo, documento_identidad, email, telefono, tipo_almohada, alergias, idiomas } = req.body;
    try {
        await pgPool.query('BEGIN'); // Transacción ACID para asegurar persistencia cruzada
        const insertPg = await pgPool.query(
            'INSERT INTO huespedes (documento_identidad, nombre_completo, email, telefono) VALUES ($1, $2, $3, $4) RETURNING id_huesped',
            [documento_identidad, nombre_completo, email, telefono]
        );
        const nuevoIdPg = insertPg.rows[0].id_huesped;

        const Perfil = mongoose.models.perfiles_huespedes || mongoose.model('perfiles_huespedes', new mongoose.Schema({}, { strict: false }));
        
        // Uso de la función reutilizable para normalizar
        const datosNormalizados = normalizarDatosMongo(alergias, idiomas);
        
        await Perfil.create({
            id_huesped_pg: nuevoIdPg,
            preferencias_habitacion: { tipo_almohada: tipo_almohada },
            restricciones_alimentarias: datosNormalizados.restricciones_alimentarias,
            idiomas: datosNormalizados.idiomas_hablados
        });

        await pgPool.query('COMMIT');
        res.status(201).json({ exito: true, mensaje: `Huésped registrado con éxito. Postgres ID: ${nuevoIdPg}` });
    } catch (error) {
        await pgPool.query('ROLLBACK');
        res.status(400).json({ exito: false, error: error.message });
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

// --- ENDPOINT: REPORTE POSTGRES (RC-06 Ocupación) ---
app.get('/api/reportes/ocupacion', async (req, res) => {
    const { inicio, fin } = req.query;
    try {
        let resultado;
        if (inicio && fin) {
            resultado = await pgPool.query('SELECT * FROM reporte_ingresos_por_plazo($1, $2)', [inicio, fin]);
        } else {
            resultado = await pgPool.query('SELECT * FROM mv_ocupacion_mensual');
        }
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: REPORTE MONGODB INTELIGENTE (RC-08 y RC-09) ---
app.get('/api/reportes/mongo-inteligente', async (req, res) => {
    const { inicio, fin } = req.query;
    try {
        const Resena = mongoose.models.resenas || mongoose.model('resenas', new mongoose.Schema({}, { strict: false }));
        
        let matchStage = { $match: {} };
        if (inicio && fin) {
            matchStage = { 
                $match: { fecha_resena: { $gte: new Date(inicio), $lte: new Date(fin) } } 
            };
        }

        const pipeline = [
            matchStage,
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
                            promedio_limpieza: { $avg: "$calificaciones.limpieza" }, // BUG CORREGIDO
                            promedio_atencion: { $avg: "$calificaciones.atencion" }  // BUG CORREGIDO
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

// --- ENDPOINT: REPORTE MONGODB INCIDENCIAS (RC-10) ---
app.get('/api/reportes/incidencias', async (req, res) => {
    try {
        const Incidencia = mongoose.models.incidencias || mongoose.model('incidencias', new mongoose.Schema({}, { strict: false }));
        const pipeline = [
            { $group: { _id: "$categoria", total_reportes: { $sum: 1 }, resueltos: { $sum: { $cond: [{ $eq: ["$estado", "resuelta"] }, 1, 0] } } } },
            { $project: { tasa_resolucion_pct: { $multiply: [{ $divide: ["$resueltos", "$total_reportes"] }, 100] }, total_reportes: 1 } },
            { $sort: { total_reportes: -1 } }
        ];
        const resultado = await Incidencia.aggregate(pipeline);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: REPORTE MONGODB PERFIL RECURRENTE (RC-11) ---
app.get('/api/reportes/perfil-recurrente', async (req, res) => {
    try {
        const Perfil = mongoose.models.perfiles_huespedes || mongoose.model('perfiles_huespedes', new mongoose.Schema({}, { strict: false }));
        const pipeline = [
            { $unwind: "$restricciones_alimentarias" },
            { $group: { _id: "$restricciones_alimentarias", afectados: { $sum: 1 } } },
            { $sort: { afectados: -1 } },
            { $limit: 5 }
        ];
        const resultado = await Perfil.aggregate(pipeline);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINT: GENERAR BACKUP FULL EN VIVO ---
app.post('/api/backup', (req, res) => {
    const env = { ...process.env, PGPASSWORD: '1234' }; 
    const comando = `"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump" -U postgres -h localhost -p 5432 -d hotel_proyecto_final -F c -f backup_hotel.dump`;
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