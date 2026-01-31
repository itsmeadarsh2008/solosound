// dev-server.js
import express from 'express';
import cors from 'cors';
import { auth } from './functions/auth.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Better Auth API routes
app.use('/api/auth', (req, res, next) => {
    if (auth && typeof auth.handler === 'function') {
        try {
            return auth.handler(req, res, next);
        } catch (err) {
            console.error('Error in auth.handler:', err);
            return res.status(500).json({ error: 'Auth handler error' });
        }
    }

    res.status(500).json({ error: 'Auth not available' });
});

app.listen(PORT, () => {
    console.log(`Auth server running on http://localhost:${PORT}`);
});