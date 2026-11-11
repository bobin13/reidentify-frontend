# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a:

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing files inside the **app** directory. This
project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Backend and PostgreSQL

Firebase remains the sign-in provider. The Node backend verifies Firebase ID
tokens and stores application data in PostgreSQL; the mobile app must not
connect to PostgreSQL directly.

Configure these values in the repository-root `.env` file:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=credentials/credentials.json

HOST_NAME=your-postgres-host
PG_PORT=5432
PG_DATABASE=your-database
PG_USER=your-database-user
PG_PASSWORD=your-database-password
PG_CA_PATH=credentials/ca.pem
```

Keep `.env` and the Firebase service-account JSON private. `PG_CA_PATH` is
optional when the CA certificate is at `credentials/ca.pem`.

Install backend dependencies, apply the additive database migration, then
start the API:

```bash
npm install --prefix backend
npm run db:migrate --prefix backend
npm start --prefix backend
```

See [MIGRATION.md](./MIGRATION.md) for the persistence changes and notes for
existing users.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
