// Custom entry: the background FCM handler has to be registered before expo-router boots
// the React tree, otherwise headless (killed-app) data messages are dropped.
import "./lib/push/background";
import "expo-router/entry";
