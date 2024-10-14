import { OpenAIRequestManager } from 'api/providers/OpenAIRequestManager';
import {
	addMessageToConversation,
	createConversation,
	getConversation,
	getConversationPath,
} from 'helpers/ConversationIOController';
import { IMessage, IMessageNode } from 'interfaces/IConversation';
import { FileSystemAdapter } from 'obsidian';
import { usePlugin } from 'providers/plugin/usePlugin';
import { useStore } from 'providers/store/useStore';
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export const useConversation = () => {
	const plugin = usePlugin();
	const conversation = useStore((state) => state.conversation);
	const setConversation = useStore((state) => state.setConversation);
	const previousConversationId = useStore((state) => state.previousConversationId);
	const setPreviousConversationId = useStore((state) => state.setPreviousConversationId);

	const [abortController, setAbortController] = useState<AbortController | null>(null);

	const openAIManager = new OpenAIRequestManager(plugin.settings.apiKey);
	const adapter = plugin.app.vault.adapter as FileSystemAdapter;

	const initConversation = async (title: string = 'Untitled') => {
		if (plugin.settings.loadLastConversation && previousConversationId) {
			try {
				await loadConversation(previousConversationId);
				return;
			} catch (error) {
				console.error(`Failed to load conversation with ID ${previousConversationId}:`, error);
			}
		}

		await createNewConversation(title);
	};

	const createNewConversation = async (title: string = 'Untitled') => {
		const conversation = await createConversation(adapter, plugin.settings.weaverDirectory, title);
		setConversation(conversation);
		setPreviousConversationId(conversation.id);
		return conversation;
	};

	const generateAssistantMessage = async (userMessage: string) => {
		if (!conversation) {
			throw new Error('No conversation initialized');
		}

		const now = Date.now() / 1000;
		const userMessageNodeId = uuidv4();
		const userMessageNode: IMessageNode = {
			id: userMessageNodeId,
			message: {
				id: userMessageNodeId,
				author: { role: 'user', name: null, metadata: {} },
				create_time: now,
				update_time: now,
				content: {
					content_type: 'text',
					parts: [userMessage],
				},
				status: 'finished_successfully',
				end_turn: true,
				weight: 1.0,
				metadata: {},
				recipient: 'all',
				channel: null,
			},
			parent: conversation.current_node,
			children: [],
		};

		await addMessageToConversation(adapter, plugin.settings.weaverDirectory, conversation.id, userMessageNode);

		conversation.current_node = userMessageNode.id;

		const conversationPath = await getConversationPath(adapter, plugin.settings.weaverDirectory, conversation.id);

		const messages: IMessage[] = conversationPath
			.filter((node) => node.message)
			.map((node) => node.message!);

		let response;

		const controller = new AbortController();
		setAbortController(controller);

		try {
			response = await openAIManager.sendMessage(messages, 'gpt-4', controller.signal);
		} catch (error) {
			if (error.message === 'Request was aborted') {
				// TODO: Handle the aborted request, perhaps update the state/UI
				console.log('Message generation was aborted');
				return;
			}
			console.error('Error sending message to OpenAI:', error);
			return;
		} finally {
			setAbortController(null);
		}

		const assistantMessageContent = response.choices[0].message?.content || '';
		const assistantMessageNodeId = uuidv4();
		const assistantMessageNode: IMessageNode = {
			id: assistantMessageNodeId,
			message: {
				id: assistantMessageNodeId,
				author: { role: 'assistant', name: null, metadata: {} },
				create_time: now,
				update_time: now,
				content: {
					content_type: 'text',
					parts: [assistantMessageContent],
				},
				status: 'finished_successfully',
				end_turn: true,
				weight: 1.0,
				metadata: {},
				recipient: 'all',
				channel: null,
			},
			parent: userMessageNode.id,
			children: [],
		};

		await addMessageToConversation(adapter, plugin.settings.weaverDirectory, conversation.id, assistantMessageNode);

		conversation.current_node = assistantMessageNodeId;
		setConversation({ ...conversation });
	};

	const loadConversation = async (conversationId: string) => {
		const conversation = await getConversation(adapter, plugin.settings.weaverDirectory, conversationId);

		if (!conversation) {
			throw new Error(`Conversation with ID ${conversationId} not found`);
		}

		setConversation(conversation);
		setPreviousConversationId(conversation.id);
	};

	const stopMessageGeneration = () => {
		if (abortController) {
			abortController.abort();
		}
	};

	const getConversationPathWithBranches = () => {
		if (!conversation) return [];
	
		const traverse = (nodeId: string, path: IMessageNode[]) => {
		const node = conversation.mapping[nodeId];

		if (!node) return;
	
		if (node.message?.author.role !== 'system') {
			path.push(node);
		}
	
		if (node.children.length > 0) {
			node.children.forEach((childId) => {
				traverse(childId, path);
			});
		}
		};
	
		const path: IMessageNode[] = [];
		traverse(conversation.current_node, path);
		return path;
	};

	return {
		conversation,
		initConversation,
		createNewConversation,
		generateAssistantMessage,
		loadConversation,
		stopMessageGeneration,
		getConversationPathWithBranches
	};
};
