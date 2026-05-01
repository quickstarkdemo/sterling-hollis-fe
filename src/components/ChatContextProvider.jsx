import { useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { DEFAULT_STORE_ID } from "../utils/apiClient";
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
      store_id: DEFAULT_STORE_ID || undefined,
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
