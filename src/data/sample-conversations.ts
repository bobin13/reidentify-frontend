export type ConversationMessage = {
  id: string;
  sender: "you" | "them";
  text: string;
  timestamp: string;
};

export type Conversation = {
  id: string;
  name: string;
  handle: string;
  preview: string;
  timestamp: string;
  unreadCount: number;
  messages: ConversationMessage[];
};

export const sampleConversations: Conversation[] = [
  {
    id: "riley-chen",
    name: "Riley Chen",
    handle: "@rileychen",
    preview: "That sounds good! See you Saturday.",
    timestamp: "9:41 AM",
    unreadCount: 2,
    messages: [
      {
        id: "riley-1",
        sender: "them",
        text: "Did you get a chance to look at the photos from yesterday?",
        timestamp: "9:32 AM",
      },
      {
        id: "riley-2",
        sender: "you",
        text: "I did, they came out great. I will send you my favorites tonight.",
        timestamp: "9:36 AM",
      },
      {
        id: "riley-3",
        sender: "them",
        text: "That sounds good! See you Saturday.",
        timestamp: "9:41 AM",
      },
    ],
  },
  {
    id: "samira-khan",
    name: "Samira Khan",
    handle: "@samirak",
    preview: "I saved you a seat near the window.",
    timestamp: "Yesterday",
    unreadCount: 1,
    messages: [
      {
        id: "samira-1",
        sender: "you",
        text: "Are we still on for coffee tomorrow?",
        timestamp: "Yesterday, 4:10 PM",
      },
      {
        id: "samira-2",
        sender: "them",
        text: "Absolutely. I saved you a seat near the window.",
        timestamp: "Yesterday, 4:18 PM",
      },
    ],
  },
  {
    id: "theo-martin",
    name: "Theo Martin",
    handle: "@theomartin",
    preview: "Here is the trail map I mentioned.",
    timestamp: "Tue",
    unreadCount: 0,
    messages: [
      {
        id: "theo-1",
        sender: "them",
        text: "You asked about an easy trail with a good view.",
        timestamp: "Tuesday, 10:04 AM",
      },
      {
        id: "theo-2",
        sender: "them",
        text: "Here is the trail map I mentioned.",
        timestamp: "Tuesday, 10:06 AM",
      },
    ],
  },
  {
    id: "ava-brooks",
    name: "Ava Brooks",
    handle: "@avabrooks",
    preview: "Thanks for sharing that recipe!",
    timestamp: "Mon",
    unreadCount: 0,
    messages: [
      {
        id: "ava-1",
        sender: "you",
        text: "I added the recipe to my notes. Let me know how it turns out.",
        timestamp: "Monday, 6:22 PM",
      },
      {
        id: "ava-2",
        sender: "them",
        text: "Thanks for sharing that recipe!",
        timestamp: "Monday, 6:30 PM",
      },
    ],
  },
];
