module.exports = ({ config }) => ({
  ...config,

  android: {
    ...config.android,
    package: config.android?.package ?? "com.reidentify.app",
  },

  plugins: [
    ...(config.plugins ?? []),
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey:
          process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    ],
  ],
});