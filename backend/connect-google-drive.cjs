require("dotenv").config();
const { connectDrive } = require("./google-drive-photos");
connectDrive().catch((error) => {
  console.error(error.message || "Could not connect Google Drive.");
  process.exitCode = 1;
});
