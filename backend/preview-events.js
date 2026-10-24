// Read-only source check. Run from the backend folder: node preview-events.js
// Does not require Firebase credentials and does not change the database.
const { SOURCES, collectSource } = require("./external-events");

async function main() {
  let failed = false;
  for (const source of SOURCES) {
    try {
      const result = await collectSource(source);
      console.log("\n" + source.name + " — " + source.area);
      console.log(JSON.stringify(result.stats, null, 2));
      const venue = result.venues[0],
        item = venue?.sessions[0];
      if (item)
        console.log({
          title: item.title,
          startUTC: item.startsAt,
          endUTC: item.endsAt,
          venue: venue.venueName,
          address: venue.location,
          coordinate: { latitude: venue.latitude, longitude: venue.longitude },
          organizer: item.sourceUrl,
        });
    } catch (error) {
      failed = true;
      console.error(source.name + ": " + error.message);
    }
  }
  if (failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});