export const INTEREST_CATEGORIES = [
  {
    id: "outdoors",
    title: "Outdoors & exercise",
    icon: "🚶",
    symbol: { ios: "figure.walk", android: "directions_walk", web: "directions_walk" },
    description: "Keep moving and enjoy the outdoors",
    activities: [
      "Walking",
      "Hiking",
      "Cycling",
      "Swimming",
      "Yoga",
      "Tai Chi",
      "Fitness/exercise",
      "Stretching",
      "Dancing",
      "Tennis",
      "Pickleball",
      "Golf",
      "Bowling",
      "Table tennis",
      "Badminton",
      "Fishing",
      "Gardening",
      "Birdwatching",
      "Nature outings",
      "Park visits",
    ],
  },
  {
    id: "games",
    title: "Games & social",
    icon: "♟️",
    symbol: { ios: "puzzlepiece.fill", android: "extension", web: "extension" },
    description: "Enjoy a game and good company",
    activities: [
      "Cards",
      "Chess",
      "Mahjong",
      "Bingo",
      "Board games",
      "Dominoes",
      "Puzzles",
      "Trivia",
      "Billiards/pool",
      "Darts",
      "Video games",
      "Social clubs",
    ],
  },
  {
    id: "arts",
    title: "Arts & crafts",
    icon: "🎨",
    symbol: { ios: "paintpalette.fill", android: "palette", web: "palette" },
    description: "Create, make and share ideas",
    activities: [
      "Painting/drawing",
      "Knitting/crochet",
      "Sewing/quilting",
      "Woodworking",
      "Pottery/ceramics",
      "Photography",
      "Scrapbooking",
      "Jewelry making",
      "Calligraphy",
      "General crafts",
      "Flower arranging",
    ],
  },
  {
    id: "music",
    title: "Music & entertainment",
    icon: "🎵",
    symbol: { ios: "music.note", android: "music_note", web: "music_note" },
    description: "Share music, performances and stories",
    activities: [
      "Singing",
      "Choir",
      "Playing an instrument",
      "Listening to music",
      "Concerts",
      "Movies",
      "Theatre",
      "Karaoke",
      "Comedy",
      "Dancing/social dance",
      "Storytelling/poetry",
    ],
  },
  {
    id: "food",
    title: "Food & social outings",
    icon: "☕",
    symbol: { ios: "cup.and.saucer.fill", android: "local_cafe", web: "local_cafe" },
    description: "Meet over a meal or a cup of tea",
    activities: [
      "Coffee/tea",
      "Dining out",
      "Cooking",
      "Baking",
      "Potlucks",
      "Picnics",
      "Brunch",
      "Food markets",
      "Community meals",
    ],
  },
  {
    id: "learning",
    title: "Learning & hobbies",
    icon: "📚",
    symbol: { ios: "book.fill", android: "menu_book", web: "menu_book" },
    description: "Explore something that interests you",
    activities: [
      "Reading",
      "Book clubs",
      "Writing",
      "History",
      "Languages",
      "Computers/technology",
      "Genealogy",
      "Museums",
      "Lectures/classes",
      "Collecting",
      "DIY/home projects",
      "Travel",
      "Astronomy/stargazing",
    ],
  },
  {
    id: "community",
    title: "Community & helping others",
    icon: "🤝",
    symbol: { ios: "hand.raised.fill", android: "volunteer_activism", web: "volunteer_activism" },
    description: "Help others and get involved locally",
    activities: [
      "Volunteering",
      "Mentoring/tutoring",
      "Charity activities",
      "Community events",
      "Neighbourhood groups",
      "Environmental cleanup",
      "Food bank/community service",
      "Animal-related volunteering",
    ],
  },
  {
    id: "culture",
    title: "Culture & personal interests",
    icon: "🌍",
    symbol: { ios: "globe.americas.fill", android: "public", web: "public" },
    description: "Connect through culture and conversation",
    activities: [
      "Religious/spiritual activities",
      "Cultural events",
      "Cultural groups",
      "Meditation",
      "Local festivals",
      "Heritage activities",
      "Current-events discussion",
      "Conversation/social meetups",
    ],
  },
] as const;

// Fewest interests an account must choose before using the app.
export const MIN_INTERESTS = 3;

export type InterestCategory =
  (typeof INTEREST_CATEGORIES)[number];

export const ALL_INTERESTS: string[] =
  INTEREST_CATEGORIES.flatMap(
    (category) => [...category.activities]
  );

// Keep recognized activities in catalogue order.
// This also removes duplicates.
export function recognizedInterests(
  values: readonly string[]
): string[] {
  const selected = new Set(values);

  return ALL_INTERESTS.filter((interest) =>
    selected.has(interest)
  );
}