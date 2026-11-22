/**
 * ממשק אחיד לספקי AI (Gemini / Groq / Claude). הממשק מוכן; המימוש מגיע בשלב 3.
 * המפתח נשמר מקומית בלבד (settings.ai.apiKey) ולא נשלח לשום מקום חוץ מהספק שנבחר.
 */
export interface AiMessage { role: 'user' | 'assistant'; content: string; imageDataUrl?: string }
export interface AiToolCall { name: string; args: unknown }
export interface AiReply { text: string; toolCalls: AiToolCall[] }

export interface AiProvider {
  id: 'gemini' | 'groq' | 'claude';
  chat(args: { apiKey: string; model: string; system: string; messages: AiMessage[]; tools: unknown[] }): Promise<AiReply>;
}
