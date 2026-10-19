const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Root Route (Welcome message taaki Cannot GET / na aaye)
app.get('/', (req, res) => {
    res.json({ status: "SenpaiFlix Server is Running Successfully! 🚀" });
});

// Free Anime Stream Sources/API Handler
app.get('/api/anime/:id/episodes', async (req, res) => {
    try {
        const animeId = req.params.id;
        res.json({
            success: true,
            animeId: animeId,
            servers: [
                { name: "Mega", embedUrl: `https://vidsrc.cc/v2/embed/anime/${animeId}` },
                { name: "HD-1", embedUrl: `https://embed.anime-stream.click/embed/${animeId}` }
            ]
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch stream links" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`SenpaiFlix server running on port ${PORT}`);
});
