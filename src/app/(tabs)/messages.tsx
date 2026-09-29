import { ScrollView, StyleSheet, Text, View } from "react-native";
import { MessageItem } from "../../components/message-item";
import { colors } from "../../constants/app-colors";
import { sampleConversations } from "../../data/sample-conversations";

export default function MessagesScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Your recent conversations</Text>
      </View>

      <View style={styles.conversationList}>
        {sampleConversations.map((conversation) => (
          <MessageItem key={conversation.id} conversation={conversation} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  heading: {
    gap: 4,
    paddingBottom: 20,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
  },
  conversationList: {
    gap: 10,
  },
});
