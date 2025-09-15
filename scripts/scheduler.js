const { spawn } = require('child_process');
const path = require('path');

function runEspnImport() {
    console.log(`Starting ESPN import at ${new Date().toISOString()}`);

    const scriptPath = path.join(__dirname, 'importEspnPlayersEnhanced.py');
    const python = spawn('python', [scriptPath]);

    python.stdout.on('data', (data) => {
        console.log(data.toString());
    });

    python.stderr.on('data', (data) => {
        console.error(data.toString());
    });

    python.on('close', (code) => {
        console.log(`ESPN import completed with code ${code} at ${new Date().toISOString()}`);
    });
}

// Run at 3:00 AM every day
function scheduleDaily() {
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(3, 0, 0, 0);

    // If 3 AM has passed today, schedule for tomorrow
    if (now > scheduledTime) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const timeUntilRun = scheduledTime.getTime() - now.getTime();

    setTimeout(() => {
        runEspnImport();
        // Schedule next run
        setInterval(runEspnImport, 24 * 60 * 60 * 1000); // Every 24 hours
    }, timeUntilRun);

    console.log(`ESPN import scheduled for ${scheduledTime.toISOString()}`);
}

if (require.main === module) {
    scheduleDaily();
} else {
    module.exports = { runEspnImport, scheduleDaily };
}