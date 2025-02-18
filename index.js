/* script website downloader YouTube by noval wa.me/6285336580720
*/
const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const app = express();
const PORT = 3000;

app.use(express.static('public'));

const drawBox = (text) => {
    const lines = text.split('\n');
    const width = Math.max(...lines.map(line => line.length)) + 4;
    const horizontalLineTop = `©FDTEAM ${'─'.repeat(width - 14)}┐`;
    const horizontalLineBottom = `©noval ${'─'.repeat(width - 14)}┘`;
    
    console.log(`┌${horizontalLineTop}`);
    lines.forEach(line => {
        console.log(`│ ${line.padEnd(width - 3)} │`);
    });
    console.log(`└${horizontalLineBottom}`);
};

const logRequestDetails = (req, type, status, extraDetails = {}) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const time = moment().tz('Asia/Jakarta').format('YYYY-MM-DDTHH:mm:ss.SSSZ');
    const url = req.query.url || 'N/A';
    const resolution = extraDetails.resolution || 'N/A';
    const duration = extraDetails.duration || 'N/A';
    const fileSize = extraDetails.fileSize || 'N/A';
    
    const logMessage = [
        `Time: ${time}`,
        `IP: ${ip}`,
        `YouTube URL: ${url}`,
        `Type: ${type}`,
        `Resolution: ${resolution}`,
        `Duration: ${duration}`,
        `File Size: ${fileSize}`,
        `Status: ${status}`
    ].join('\n');
    
    drawBox(logMessage);
};

const validateFileSize = (filePath, maxSizeMB) => {
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    return fileSizeMB <= maxSizeMB;
};

const deleteFileAfterDelay = (filePath, delay = 5 * 60 * 1000) => {
    setTimeout(() => {
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error(`Error deleting file ${filePath}: ${err.message}`);
            } else {
                console.log(`File ${filePath} has been deleted.`);
            }
        });
    }, delay);
};

app.get('/info', async (req, res) => {
    const url = req.query.url;
    if (!url || !ytdl.validateURL(url)) {
        logRequestDetails(req, 'info', 'Failed: Invalid URL');
        return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    try {
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;

        const response = {
            title: videoDetails.title,
            uploader: videoDetails.author.name,
            thumbnail: videoDetails.thumbnails[0].url,
            duration: new Date(videoDetails.lengthSeconds * 1000).toISOString().substr(11, 8),
            resolutions: info.formats
                .filter(f => f.hasVideo && f.container === 'mp4')
                .map(f => ({ height: f.height, size: (f.contentLength / (1024 * 1024)).toFixed(2) + ' MB' }))
                .filter((value, index, self) => self.findIndex(v => v.height === value.height) === index)
                .sort((a, b) => b.height - a.height),
            audioBitrates: info.formats
                .filter(f => f.hasAudio)
                .map(f => ({ bitrate: f.audioBitrate, size: (f.contentLength / (1024 * 1024)).toFixed(2) + ' MB' }))
                .filter((value, index, self) => self.findIndex(v => v.bitrate === value.bitrate) === index)
                .sort((a, b) => b.bitrate - a.bitrate)
        };

        logRequestDetails(req, 'info', 'Success', {
            resolution: 'N/A',
            duration: response.duration,
            fileSize: 'N/A'
        });

        res.json(response);
    } catch (error) {
        logRequestDetails(req, 'info', `Failed: ${error.message}`);
        res.status(500).json({ error: 'Error fetching video info' });
    }
});

app.get('/download', async (req, res) => {
    const url = req.query.url;
    const resolution = parseInt(req.query.resolution, 10);
    if (!url || !ytdl.validateURL(url)) {
        logRequestDetails(req, 'download', 'Failed: Invalid URL');
        return res.status(400).send('Invalid YouTube URL');
    }

    try {
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;

        const videoFormat = info.formats.find(f => f.height === resolution && f.container === 'mp4');
        const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });

        if (!videoFormat) {
            throw new Error('No suitable video format found.');
        }
        if (!audioFormat) {
            throw new Error('No suitable audio format found.');
        }

        const videoPath = path.join(__dirname, 'tmp', `video_${Date.now()}.mp4`);
        const audioPath = path.join(__dirname, 'tmp', `audio_${Date.now()}.mp4`);
        const outputPath = path.join(__dirname, 'tmp', `output_${Date.now()}.mp4`);

        await new Promise((resolve, reject) => {
            ytdl(url, { format: videoFormat })
                .pipe(fs.createWriteStream(videoPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        await new Promise((resolve, reject) => {
            ytdl(url, { format: audioFormat })
                .pipe(fs.createWriteStream(audioPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions(['-c:v copy', '-c:a aac', '-strict experimental'])
                .save(outputPath)
                .on('end', resolve)
                .on('error', reject);
        });

        const fileSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);

        if (!validateFileSize(outputPath, 350)) {
            return res.status(400).send('File size exceeds the 350 MB limit.');
        }

        res.download(outputPath, `${videoDetails.title}.mp4`, (err) => {
            if (!err) {
                logRequestDetails(req, 'download', 'Success', {
                    resolution: `${resolution}p`,
                    duration: videoDetails.lengthSeconds,
                    fileSize: `${fileSizeMB} MB`
                });
            } else {
                logRequestDetails(req, 'download', 'Failed: Download error', {
                    resolution: `${resolution}p`,
                    duration: videoDetails.lengthSeconds,
                    fileSize: `${fileSizeMB} MB`
                });
            }

            deleteFileAfterDelay(videoPath);
            deleteFileAfterDelay(audioPath);
            deleteFileAfterDelay(outputPath);
        });
    } catch (error) {
        logRequestDetails(req, 'download', `Failed: ${error.message}`);
        res.status(500).send(`Error downloading video: ${error.message}`);
    }
});

app.get('/audio', async (req, res) => {
    const url = req.query.url;
    const bitrate = parseInt(req.query.bitrate, 10);
    if (!url || !ytdl.validateURL(url)) {
        logRequestDetails(req, 'audio', 'Failed: Invalid URL');
        return res.status(400).send('Invalid YouTube URL');
    }

    try {
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;

        const audioFormat = ytdl.chooseFormat(info.formats, {
            quality: 'highestaudio',
            filter: 'audioonly',
            audioBitrate: bitrate
        });

        if (!audioFormat) {
            throw new Error('No suitable audio format found.');
        }

        const audioPath = path.join(__dirname, 'tmp', `audio_${Date.now()}.mp3`);

        await new Promise((resolve, reject) => {
            ytdl(url, { format: audioFormat })
                .pipe(fs.createWriteStream(audioPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        const fileSizeMB = (fs.statSync(audioPath).size / (1024 * 1024)).toFixed(2);

        if (!validateFileSize(audioPath, 200)) {
            return res.status(400).send('Audio file size exceeds the 200 MB limit.');
        }

        res.download(audioPath, `${videoDetails.title}_${bitrate}kbps.mp3`, (err) => {
            if (!err) {
                logRequestDetails(req, 'audio', 'Success', {
                    resolution: 'N/A',
                    duration: videoDetails.lengthSeconds,
                    fileSize: `${fileSizeMB} MB`
                });
            } else {
                logRequestDetails(req, 'audio', 'Failed: Download error', {
                    resolution: 'N/A',
                    duration: videoDetails.lengthSeconds,
                    fileSize: `${fileSizeMB} MB`
                });
            }

            deleteFileAfterDelay(audioPath);
        });
    } catch (error) {
        logRequestDetails(req, 'audio', `Failed: ${error.message}`);
        res.status(500).send(`Error downloading audio: ${error.message}`);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
