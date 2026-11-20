const { transaction } = require("./postgres");
const { leaveAllGroupsTx } = require("./groups-routes");

// In-app account deletion (required by the App Store for apps with sign-up).
// Removes the member's data and their Firebase login together.
function installAccountRoutes(app, db, { firebaseAuth, onDeleted, now = Date.now }) {
  app.post("/api/me/delete", async (req, res, next) => {
    if (req.body?.confirm !== "DELETE") {
      return res
        .status(400)
        .json({ message: "Confirm that you want to delete your account." });
    }
    try {
      await transaction(db, async (client) => {
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
          req.userId,
        ]);
        // Same as pressing Leave in each group, so member counts stay right
        // and a group left empty closes.
        await leaveAllGroupsTx(client, req.userId, new Date(now()));
        // Everything else that belongs to the member cascades from users.
        await client.query("DELETE FROM users WHERE id = $1", [req.userId]);
        // Last, so a Firebase failure rolls the database back and the member
        // can try again with nothing half-deleted.
        try {
          await firebaseAuth.deleteUser(req.account.uid);
        } catch (error) {
          if (error.code !== "auth/user-not-found") throw error;
        }
      });
    } catch (error) {
      return next(error);
    }
    onDeleted?.(req.account.uid);
    res.json({ deleted: true });
  });
}

module.exports = { installAccountRoutes };
