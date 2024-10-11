import { createContext } from "react";
import { ConversationService } from "services/conversation/ConversationService";

export const ConversationServiceContext = createContext<ConversationService | undefined>(undefined);
