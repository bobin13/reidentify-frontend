export type FeedPost = {
  authorName: string;
  handle: string;
  timestamp: string;
  content: string;
  likes: number;
  comments: number;
};

export const sampleFeedPosts: FeedPost[] = [
  {
    authorName: "Maya Chen",
    handle: "@mayachen",
    timestamp: "2h ago",
    content:
      "Spent the morning walking the old harbor. The light changed every few minutes, and every corner seemed to have a story.",
    likes: 24,
    comments: 6,
  },
  {
    authorName: "Jordan Lee",
    handle: "@jordanlee",
    timestamp: "5h ago",
    content:
      "A small weekend project: turning a forgotten shelf into a home for my favorite books and plants. Still deciding what belongs on the top shelf.",
    likes: 18,
    comments: 3,
  },
  {
    authorName: "Avery Patel",
    handle: "@averyp",
    timestamp: "Yesterday",
    content:
      "Tried a new route through the botanical garden and found a quiet spot I had somehow missed before. Taking the long way home was worth it.",
    likes: 31,
    comments: 4,
  },
  {
    authorName: "Noah Williams",
    handle: "@noahw",
    timestamp: "Yesterday",
    content:
      "Made enough soup for the whole week, then shared the first batch with the neighbors. Swapping recipes might become a new tradition.",
    likes: 15,
    comments: 7,
  },
  {
    authorName: "Sofia Rivera",
    handle: "@sofiar",
    timestamp: "2 days ago",
    content:
      "Finally finished the sketchbook I started this spring. It is funny how much a few pages can capture about a season.",
    likes: 42,
    comments: 9,
  },
];
