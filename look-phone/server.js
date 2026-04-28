require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { lookupSMS } = require('./services/sms');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

/**
 * GET /sms?Owner=boss$$&phone=1234567890
 * Lookup SMS verification code for a phone number
 */
app.get('/sms', async (req, res) => {
    const { Owner, phone } = req.query;

    // Validate required parameters
    if (!Owner || !phone) {
        return res.status(400).json({
            error: 'Missing Owner or phone parameter',
            usage: '/sms?Owner=yourowner&phone=1234567890'
        });
    }

    try {
        const result = await lookupSMS(phone, Owner);
        res.json(result);
    } catch (error) {
        const status = error.status || 500;
        const errorResponse = {
            error: error.message,
            phone: phone,
            owner: Owner
        };

        if (error.daysRemaining !== undefined) {
            errorResponse.daysRemaining = error.daysRemaining;
        }

        res.status(status).json(errorResponse);
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'SMS Lookup API',
        endpoints: {
            sms: '/sms?Owner=yourowner&phone=1234567890'
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SMS Lookup API running on port ${PORT}`);
    console.log(`📍 Endpoint: http://localhost:${PORT}/sms?Owner=yourowner&phone=xxx`);
});
