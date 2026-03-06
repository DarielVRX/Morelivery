// test-db.js
import pkg from "pg";
const { Client } = pkg;

const client = new Client({
    host: "localhost",
    port: 6543,
    user: "darielv",
    password: "TheGazettE",
    database: "Morelivery",
});

try {
    await client.connect();
    console.log("Conexión exitosa!");
} catch (err) {
    console.error(err);
} finally {
    await client.end();
}
