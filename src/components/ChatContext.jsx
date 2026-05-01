import { createContext, useContext, useEffect } from "react";
import { useLocation } from "react-router-dom";

export const ChatContext = createContext(null);

export function useChatContext() {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error("useChatContext must be used within ChatContextProvider");
  }
  return value.chatContext;
}

export function usePageChatContext(context) {
  const value = useContext(ChatContext);
  const location = useLocation();
  const setChatContext = value?.setChatContext;

  useEffect(() => {
    if (!setChatContext) return undefined;

    setChatContext({
      route: location.pathname,
      ...context,
    });

    return () => {
      setChatContext({});
    };
  }, [context, location.pathname, setChatContext]);

  if (!value) {
    throw new Error("usePageChatContext must be used within ChatContextProvider");
  }
}
