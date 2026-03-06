import pkg from "pg";
import fs from "fs";
const { Client } = pkg;

async function initDB() {
    const client = new Client({
        user: "darielv",        // tu usuario PostgreSQL
        host: "localhost",
        database: "postgres",   // conectamos a la DB por defecto
        password: "TheGazettE0",
        port: 5432,
    });

    await client.connect();

    // Crear la base de datos Morelivery si no existe
    await client.query(`CREATE DATABASE "Morelivery";`);

    // Conectarse a la nueva base de datos
    await client.end();

    const client2 = new Client({
        user: "darielv",
        host: "localhost",
        database: "Morelivery",
        password: "TheGazettE0",
        port: 5432,
    });
    await client2.connect();

    // Cargar schema.sql
    const sql = fs.readFileSync("./database/schema.sql").toString();
    await client2.query(sql);
    await client2.end();

    console.log("Database Morelivery creada e inicializada ✅");
}

initDB().catch(err => console.error(err));
