import { useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { ChatContext } from "./ChatContext";

export default function ChatContextProvider({ children }) {
  const location = useLocation();
  const [pageContext, setPageContext] = useState({});

  const setChatContext = useCallback((context = {}) => {
    setPageContext(context);
  }, []);

  const chatContext = useMemo(
    () => ({
      page_type: "home",
      ...pageContext,
      route: pageContext.route || location.pathname,
    }),
    [location.pathname, pageContext],
  );

  const value = useMemo(
    () => ({
      chatContext,
      setChatContext,
    }),
    [chatContext, setChatContext],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
