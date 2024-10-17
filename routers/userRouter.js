import express from 'express'
import postgresClient from '../config/db.js'

const router = express.Router()

// Duyuru ekleme
router.post('/', async (req, res) => {
    const client = await postgresClient.connect();
    
    try {
        const { 
            title, description, created_date, update_date, 
            ilan_baslangic_tarihi, ilan_bitis_tarihi, url, status, 
            is_deleted, is_active, departments 
        } = req.body;
        
        await client.query('BEGIN');

        const duyuruText = `
            WITH new_duyuru AS (
                INSERT INTO duyurular (
                    title, description, created_date, update_date, 
                    ilan_baslangic_tarihi, ilan_bitis_tarihi, url, status, 
                    is_deleted, is_active
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                )
                RETURNING id
            ),
            inserted_departments AS (
                INSERT INTO duyuru_departman (departman_id, duyuru_id)
                SELECT unnest($11::int[]), new_duyuru.id
                FROM new_duyuru
                RETURNING departman_id, duyuru_id
            )
            SELECT * FROM new_duyuru, inserted_departments
        `;

        const duyuruValues = [
            title, description, created_date, update_date, 
            ilan_baslangic_tarihi, ilan_bitis_tarihi, url, status, 
            is_deleted, is_active, departments
        ];

        const result = await client.query(duyuruText, duyuruValues);
        
        await client.query('COMMIT');
        
        res.status(201).json({ createdDuyuru: result.rows });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

// Duyuru güncelleme
router.put('/update/:id', async (req, res) => {
    const client = await postgresClient.connect();
    
    try {
        const { id } = req.params;
        const { 
            title, description, created_date, update_date, 
            ilan_baslangic_tarihi, ilan_bitis_tarihi, url, status, 
            is_deleted, is_active
        } = req.body;

        await client.query('BEGIN');

        const duyuruText = `
            UPDATE duyurular
            SET 
                title = $1, description = $2, created_date = $3, update_date = $4, 
                ilan_baslangic_tarihi = $5, ilan_bitis_tarihi = $6, url = $7, status = $8, 
                is_deleted = $9, is_active = $10
            WHERE id = $11
            RETURNING *;
        `;

        const duyuruValues = [
            title, description, created_date, update_date, 
            ilan_baslangic_tarihi, ilan_bitis_tarihi, url, status, 
            is_deleted, is_active, id
        ];

        const result = await client.query(duyuruText, duyuruValues);
        
        await client.query('COMMIT');
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Duyuru not found' });
        }

        res.status(200).json({ updatedDuyuru: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});


// Tüm duyuruları getirme
router.get('/all', async (req, res) => {
    const client = await postgresClient.connect();

    try {
        const result = await client.query('SELECT * FROM duyurular WHERE is_deleted = FALSE');
        res.status(200).json({ duyurular: result.rows });
    } catch (error) {
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

// Belirli bir departmana atanan duyuruları getirme
router.get('/by-departments', async (req, res) => {
    const client = await postgresClient.connect();

    try {
        const { departmentIds } = req.body; // departman_id array

        const result = await client.query(`
            SELECT d.*
            FROM duyurular d
            JOIN duyuru_departman dd ON d.id = dd.duyuru_id
            WHERE dd.departman_id = ANY($1::int[]) AND d.is_deleted = FALSE
        `, [departmentIds]);

        res.status(200).json({ duyurular: result.rows });
    } catch (error) {
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

// Kullanıcının duyuruyu okuduğunu kaydetme
router.post('/read', async (req, res) => {
    const client = await postgresClient.connect();
    
    try {
        const { user_id, duyuru_id } = req.body;
        
        const created_date = new Date();

        const insertQuery = `
            INSERT INTO duyuru_user (user_id, duyuru_id, created_date)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const values = [user_id, duyuru_id, created_date];

        const result = await client.query(insertQuery, values);

        res.status(201).json({ duyuruUser: result.rows[0] });
    } catch (error) {
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

router.get('/readers/:duyuruId', async (req, res) => {
    const client = await postgresClient.connect();

    try {
        const { duyuruId } = req.params;

        const result = await client.query(`
            SELECT u.*
            FROM duyuru_user u
            JOIN duyuru_user du ON u.id = du.user_id
            WHERE du.duyuru_id = $1 AND du.is_deleted = FALSE
        `, [duyuruId]);

        res.status(200).json({ users: result.rows });
    } catch (error) {
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});


router.get('/is_reader/:userId', async (req, res) => {
    const client = await postgresClient.connect();

    try {
        const { userId } = req.params;

        // Kullanıcının departmanlarını bulma
        const departmentResult = await client.query(`
            SELECT departman_id
            FROM duyuru_departman
            WHERE id = $1
        `, [userId]);

        const departmentIds = departmentResult.rows.map(row => row.departman_id);

        if (departmentIds.length === 0) {
            return res.status(404).json({ message: 'Kullanıcıya ait departman bulunamadı' });
        }

        // Departmanlara ait duyuruları bulma
        const duyuruResult = await client.query(`
            SELECT d.*, 
            CASE 
                WHEN du.id IS NOT NULL THEN true 
                ELSE false 
            END as is_read
            FROM duyurular d
            LEFT JOIN duyuru_departman dd ON d.id = dd.duyuru_id
            LEFT JOIN duyuru_user du ON d.id = du.duyuru_id AND du.id = $1
            WHERE dd.departman_id = ANY($2::int[]) AND d.is_deleted = FALSE
        `, [userId, departmentIds]);

        res.status(200).json({ duyurular: duyuruResult.rows });
    } catch (error) {
        console.error('Error occurred:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});




export default router;
