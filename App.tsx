import React, { useState, useEffect, useRef, useMemo } from 'react';
import ChatArea from './components/ChatArea';
import NovelView from './components/NovelView';
import SettingsModal from './components/SettingsModal';
import LibraryModal from './components/LibraryModal';
import ComparisonModal from './components/ComparisonModal';
import AnchorModal from './components/AnchorModal';
import { generateStreamResponse } from './services/aiService';
import { Message, AppSettings, ViewMode, NovelSession, OptimizationState, AnchorConfig } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { SettingsIcon, BookOpenIcon, MessageSquareIcon, MailIcon, SunIcon, MoonIcon, EyeIcon, XIcon, LibraryIcon, HelpCircleIcon, HistoryIcon, EditIcon, SparklesIcon, SpeakerIcon, UserIcon } from './components/Icons';

// Helper to clean titles
const cleanTitle = (rawTitle: string) => {
    return rawTitle
        .replace(/^[#*\s>]+/, '') 
        .replace(/[#*]+$/, '')     
        .replace(/^\d+\.\s*/, '')  
        .trim();
};

// Helper to remove Options tags from AI response
const cleanAIResponse = (text: string) => {
    return text.replace(/(?:^|\n)\s*(?:\*\*|__)?Options(?:\*\*|__)?[:：][\s\S]*$/i, '').trim();
};

// Helper to create a default novel session
const createDefaultNovel = (): NovelSession => ({
  id: Date.now().toString(),
  title: '未命名小说',
  createdAt: Date.now(),
  lastModified: Date.now(),
  messages: [{
    id: 'init-1',
    role: 'model',
    content: '你好！我是你的 AI 小说创作助手。\n\n我们将分三步完成创作：\n1. **确认基础设定**（书名、题材、故事线）。\n2. **生成数据库**（大纲、角色）。\n3. **生成正文**。\n\n请告诉我你想写什么类型的故事？\n\nOptions: [玄幻修仙] [赛博朋克] [都市异能]',
    timestamp: Date.now()
  }],
  settings: { ...DEFAULT_SETTINGS },
  anchorConfig: { enabled: false, mode: 'chapter', chapterInterval: 20, nextTrigger: 20 },
  snowflakeMode: false
});

// Helper to migrate legacy settings
const migrateSettings = (savedSettings: any): AppSettings => {
    if (!savedSettings) return { ...DEFAULT_SETTINGS };
    return {
        ...DEFAULT_SETTINGS,
        ...savedSettings,
        siteSettings: {
            ...DEFAULT_SETTINGS.siteSettings,
            ...(savedSettings.siteSettings || {})
        },
        mcpItems: savedSettings.mcpItems || DEFAULT_SETTINGS.mcpItems,
        skillItems: savedSettings.skillItems || DEFAULT_SETTINGS.skillItems
    };
};

// Toast Component
interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

function App() {
  const [novels, setNovels] = useState<NovelSession[]>(() => {
    try {
        const library = localStorage.getItem('inkflow_library');
        if (library) {
            const parsed = JSON.parse(library);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Migrate settings for all existing novels
                return parsed.map((n: any) => ({
                    ...n,
                    settings: migrateSettings(n.settings)
                }));
            }
        }
        const oldMessages = localStorage.getItem('inkflow_messages');
        const oldSettings = localStorage.getItem('inkflow_settings');
        if (oldMessages) {
            const msgs = JSON.parse(oldMessages);
            let title = '未命名小说';
            const titleMatch = msgs.find((m: Message) => m.role === 'model' && m.content.match(/小说名[:：]\s*《?([^》\n]+)》?/));
            if (titleMatch) {
                const m = titleMatch.content.match(/小说名[:：]\s*《?([^》\n]+)》?/);
                if (m && m[1]) title = cleanTitle(m[1]);
            }
            const initialNovel: NovelSession = {
                id: 'default-' + Date.now(),
                title: title,
                createdAt: Date.now(),
                lastModified: Date.now(),
                messages: msgs,
                settings: migrateSettings(oldSettings ? JSON.parse(oldSettings) : null),
                anchorConfig: { enabled: false, mode: 'chapter', chapterInterval: 20, nextTrigger: 20 },
                snowflakeMode: false
            };
            return [initialNovel];
        }
        return [createDefaultNovel()];
    } catch (e) {
        console.error("Failed to load library", e);
        return [createDefaultNovel()];
    }
  });

  const [currentNovelId, setCurrentNovelId] = useState<string>(() => {
      try {
        const library = localStorage.getItem('inkflow_library');
        if (library) {
            const parsed = JSON.parse(library);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
        }
      } catch {}
      return '';
  });

  // Welcome Modal State
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [welcomeStep, setWelcomeStep] = useState(0);

  const welcomeSteps = [
    { title: "欢迎使用 InkFlow", icon: "👋", content: "这是一款专为网文作者打造的 AI 辅助创作工具，结合了对话创作与大纲管理的双屏体验。" },
    { title: "第一步：配置模型", icon: "⚙️", content: "点击右上角的设置图标。填入你的 API Key (支持 OpenAI/DeepSeek) 并设定小说篇幅目标。" },
    { title: "第二步：对话构思", icon: "💡", content: "在左侧对话框与 AI 聊天。确定书名、大纲、角色设定。AI 生成的内容会自动归档到右侧数据库。" },
    { title: "第三步：正文写作", icon: "✍️", content: "切换到右侧【章节正文】标签。点击生成目录，然后使用【批量撰写】功能快速产出正文。" },
    { title: "第四步：防止遗忘", icon: "🧠", content: "遇到长文遗忘？点击右上角的【⚓ 剧情锚点】压缩上下文。需要严谨结构？开启【❄️ 雪花法】模式。" },
    { title: "加入社区", icon: "👨‍👩‍👧‍👦", content: "点击右下角浮窗或联系开发者，加入 InkFlow 微信交流群，获取更多写作技巧！" }
  ];

  useEffect(() => {
      const visited = localStorage.getItem('inkflow_visited');
      if (!visited) {
          setIsWelcomeOpen(true);
          localStorage.setItem('inkflow_visited', 'true');
      }
  }, []);

  useEffect(() => {
      if (novels.length === 0) setNovels([createDefaultNovel()]);
      else if (!currentNovelId && novels.length > 0) setCurrentNovelId(novels[0].id);
  }, [novels, currentNovelId]);

  const activeNovel = useMemo(() => novels.find(n => n.id === currentNovelId) || novels[0], [novels, currentNovelId]);
  const messages = activeNovel?.messages || [];
  const settings = activeNovel?.settings || DEFAULT_SETTINGS;

  // Dynamic Document Title Logic
  const [isStreaming, setIsStreaming] = useState(false);
  
  useEffect(() => {
      const siteName = activeNovel.settings?.siteSettings?.siteName || "InkFlow";
      const currentTitle = activeNovel?.title;
      const isDefault = !currentTitle || currentTitle === '未命名小说';
      
      if (isDefault) {
          document.title = isStreaming ? `生成中... - ${siteName}` : siteName;
      } else {
          const status = isStreaming ? '生成中' : '创作中';
          document.title = `${currentTitle} - ${status} - ${siteName}`;
      }
  }, [activeNovel?.title, isStreaming, activeNovel.settings]);

  const [inputValue, setInputValue] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Theme state: 'light' | 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { 
        const stored = localStorage.getItem('inkflow_theme');
        return (stored === 'light' || stored === 'dark') ? stored : 'dark'; 
    } catch { return 'dark'; }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isAnchorModalOpen, setIsAnchorModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Split);
  const [optState, setOptState] = useState<OptimizationState | null>(null);

  // Toast State
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  useEffect(() => { if (novels.length > 0) localStorage.setItem('inkflow_library', JSON.stringify(novels)); }, [novels]);
  
  // Apply theme classes
  useEffect(() => { 
      localStorage.setItem('inkflow_theme', theme); 
      const html = document.documentElement;
      html.classList.remove('dark', 'light', 'ec'); 
      
      if (theme === 'dark') {
          html.classList.add('dark');
      }
      // 'light' is default (no class)
  }, [theme]);

  if (!activeNovel) return null;

  const toggleTheme = () => {
      setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const createNewNovel = () => {
      const newNovel = createDefaultNovel();
      newNovel.id = Date.now().toString(); 
      setNovels(prev => [newNovel, ...prev]);
      setCurrentNovelId(newNovel.id);
      setIsLibraryOpen(false);
      return newNovel.id;
  };

  const deleteNovel = (id: string) => {
      const newNovels = novels.filter(n => n.id !== id);
      setNovels(newNovels); 
      if (currentNovelId === id) {
          if (newNovels.length > 0) setCurrentNovelId(newNovels[0].id);
          else { const def = createDefaultNovel(); setNovels([def]); setCurrentNovelId(def.id); }
      }
  };

  const renameNovel = (id: string, newTitle: string) => {
      setNovels(prev => prev.map(n => n.id === id ? { ...n, title: cleanTitle(newTitle), lastModified: Date.now() } : n));
  };

  const updateActiveNovel = (updates: Partial<NovelSession>) => {
      if (!activeNovel) return;
      setNovels(prev => prev.map(n => n.id === activeNovel.id ? { ...n, ...updates, lastModified: Date.now() } : n));
  };

  const updateMessages = (newMessages: Message[]) => {
      updateActiveNovel({ messages: newMessages });
  };
  
  const updateSettings = (newSettings: AppSettings) => { updateActiveNovel({ settings: newSettings }); };

  // --- Logic for Anchor ---

  const executeAnchor = async (currentHistory: Message[] = messages, silent: boolean = false): Promise<Message[]> => {
      if (isStreaming && !silent) {
          showToast("AI 正在生成中，请稍后再试", "error");
          return currentHistory;
      }
      
      if (!silent) showToast("正在启动剧情锚定程序...", "info");

      setIsStreaming(true);
      const prompt = `【系统指令：分段锚定/卷末总结】
请对截止目前的小说内容进行“分段锚定”处理。我们将把长篇小说按“卷”或“单元”进行切割。
请生成一份高浓度的【剧情锚点】，用于作为下一卷的启动上下文。

请严格包含以下模块：
1. **卷末剧情总结**：简要概括当前这一卷/单元的核心剧情发生了什么，结局如何。
2. **核心锚点 (State)**：
   - 主角当前的物理状态（位置、等级、持有物）。
   - 主角当前的人际关系（盟友、敌人、待解决的羁绊）。
3. **关键未解伏笔**：下一卷必须要处理的剧情线索。
4. **衔接段**：一小段用于开启下一卷的“前情提要”，确保语气和文风连贯。

请以 \`## 剧情锚点\` 开头输出。`;

      const anchorMsgId = 'anchor-req-' + Date.now();
      const userMsg: Message = { id: anchorMsgId, role: 'user', content: prompt, timestamp: Date.now() };
      let tempHistory = [...currentHistory, userMsg];
      
      const aiMsgId = 'anchor-res-' + Date.now();
      const placeholder: Message = { id: aiMsgId, role: 'model', content: '', timestamp: Date.now() + 1 };
      
      updateMessages([...tempHistory, placeholder]);

      try {
          let summary = "";
          await generateStreamResponse(tempHistory, prompt, settings, activeNovel.contextSummary, (chunk) => {
              summary += chunk;
              setNovels(prev => prev.map(n => {
                  if (n.id === activeNovel.id) {
                      const newMsgs = [...n.messages];
                      const idx = newMsgs.findIndex(m => m.id === aiMsgId);
                      if (idx !== -1) newMsgs[idx] = { ...newMsgs[idx], content: summary };
                      return { ...n, messages: newMsgs };
                  }
                  return n;
              }));
          });
          
          const finalSummary = cleanAIResponse(summary);
          
          const systemNotice: Message = {
              id: 'sys-notice-' + Date.now(),
              role: 'model',
              content: `✅ **锚点构建成功 (分段锚定完成)**\n\n历史剧情已归档到 AI 记忆中。历史消息已保留在界面上，但 AI 将仅关注最新的剧情锚点和后续内容，以节省 Token 并保持逻辑连贯。\n\n**当前锚点摘要：**\n${finalSummary.slice(0, 100)}...`,
              timestamp: Date.now()
          };
          
          const finalMessages = [...currentHistory, userMsg, { ...placeholder, content: finalSummary }, systemNotice];
          
          setNovels(prev => prev.map(n => n.id === activeNovel.id ? { ...n, messages: finalMessages, contextSummary: finalSummary, lastModified: Date.now() } : n));
          
          if (!silent) showToast("剧情锚点构建成功！历史记录已保留。", "success");
          return finalMessages;

      } catch (e) {
          console.error("Anchoring failed", e);
          if (!silent) showToast("锚点构建失败，请检查网络", "error");
          return currentHistory;
      } finally {
          setIsStreaming(false);
      }
  };

  const handleAnchorClick = () => {
      setIsAnchorModalOpen(true);
  };

  const parseChatForConfig = (content: string) => {
      const titleRegex = /(?:书名|小说名)[:：]\s*《?([^》\n]+)》?/;
      const titleMatch = content.match(titleRegex);
      if (titleMatch && titleMatch[1]) {
          const rawTitle = titleMatch[1];
          if (!rawTitle.includes('Options') && rawTitle.length < 30) {
            const clean = cleanTitle(rawTitle);
            if (clean && clean !== activeNovel.title) updateActiveNovel({ title: clean });
          }
      }
      
      const chapMatch = content.match(/(?:全书预计|Total Novel Chapters|全书共|本书共)[:：]?\s*(\d+)\s*章/i);
      if (chapMatch && chapMatch[1]) {
          const num = parseInt(chapMatch[1]);
          if (num > 10 && num !== settings.targetTotalChapters) {
              updateSettings({ ...settings, targetTotalChapters: num });
          }
      }

      const wordMatch = content.match(/(?:每章|单章|字数|words|设定为|字数目标)\D{0,10}?(\d+)\s*字/i);
      if (wordMatch && wordMatch[1]) {
          const num = parseInt(wordMatch[1]);
           if (num > 0 && num !== settings.targetWordsPerChapter) updateSettings({ ...settings, targetWordsPerChapter: num });
      }
  };

  const novelStats = useMemo(() => {
      let currentChapters = 0;
      let totalWordCount = 0;
      messages.filter(m => m.role === 'model').forEach(m => {
           const matches = m.content.matchAll(/(^|\n)##\s*(第[0-9一二三四五六七八九十]+章\s*[^\n]*)([\s\S]*?)(?=(\n##\s*第|$))/g);
           for (const match of matches) {
               currentChapters++;
               const chapterContent = match[3] || '';
               totalWordCount += chapterContent.replace(/[#*`\s]/g, '').length; 
           }
      });
      return { currentChapters, totalChapters: settings.targetTotalChapters || 20, wordCount: totalWordCount };
  }, [messages, settings.targetTotalChapters]);

  const updateMessagesThrottled = (novelId: string, aiMsgId: string, newContent: string) => {
      setNovels(prevNovels => {
          return prevNovels.map(n => {
              if (n.id === novelId) {
                  const newMsgs = [...n.messages];
                  const lastMsgIndex = newMsgs.findIndex(m => m.id === aiMsgId);
                  if (lastMsgIndex !== -1) {
                      newMsgs[lastMsgIndex] = { ...newMsgs[lastMsgIndex], content: newContent };
                  }
                  return { ...n, messages: newMsgs, lastModified: Date.now() };
              }
              return n;
          });
      });
  };

  const sendMessage = async (text: string, currentHistory: Message[] = messages) => {
    if (!activeNovel.contextSummary && currentHistory.length > 50) {
        showToast("检测到对话过长，建议点击【剧情锚点】压缩上下文，避免遗忘。", "info");
    }

    setIsStreaming(true);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    let uiHistory = [...currentHistory];
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
    uiHistory.push(userMsg);
    setInputValue(''); 
    
    const aiMsgId = (Date.now() + 1).toString();
    const aiMsgPlaceholder: Message = { id: aiMsgId, role: 'model', content: '', timestamp: Date.now() + 1 };
    uiHistory.push(aiMsgPlaceholder);
    
    updateMessages(uiHistory);

    try {
      let fullResponseText = '';
      let lastUpdateTime = 0;
      
      await generateStreamResponse(uiHistory, userMsg.content, settings, activeNovel.contextSummary, (chunk) => {
          fullResponseText += chunk;
          const now = Date.now();
          if (now - lastUpdateTime > 100) {
              updateMessagesThrottled(activeNovel.id, aiMsgId, fullResponseText);
              lastUpdateTime = now;
          }
        }, signal);
      
      updateMessagesThrottled(activeNovel.id, aiMsgId, fullResponseText);
      parseChatForConfig(fullResponseText);
      return fullResponseText;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
          console.error(error);
          setNovels(prev => prev.map(n => {
              if (n.id === activeNovel.id) {
                  return { ...n, messages: [...n.messages, { id: Date.now().toString(), role: 'model', content: `⚠️ Error: ${error?.message || 'Unknown error'}`, timestamp: Date.now() }] };
              }
              return n;
          }));
      }
      throw error;
    } finally {
      if (!abortControllerRef.current?.signal.aborted) setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value);

  const handleUserSend = (text?: string) => {
      if (isStreaming) return;
      const content = text || inputValue;
      if (!content.trim()) return;

      if (content === '继续写下一章') { handleBatchContent(1); return; }
      if (content === '重写本章') {
           const lastModelMsg = messages[messages.length - 1];
           if (lastModelMsg.role === 'model' && lastModelMsg.content.includes('## 第')) {
               const titleMatch = lastModelMsg.content.match(/##\s*(第[^\s]+章\s*[^\n]*)/);
               if (titleMatch) { handleChapterAction('regenerate', titleMatch[1], lastModelMsg.content, lastModelMsg.id); return; }
           }
      }
      sendMessage(content);
  };

  const handleStop = () => { if (abortControllerRef.current) { abortControllerRef.current.abort(); setIsStreaming(false); } };

  const handleMessageEdit = (id: string, newContent: string) => {
      const newMessages = messages.map(m => m.id === id ? { ...m, content: newContent } : m);
      updateActiveNovel({ messages: newMessages });
  };

  const handleSummarize = async () => {
      if (isStreaming) return;
      await sendMessage("请简要总结之前的对话内容，包含已确定的核心设定、故事进展以及当前待解决的问题。");
  };
  
  const handleSnowflakeToggle = async () => {
      if (isStreaming) return;
      
      const newMode = !activeNovel.snowflakeMode;
      updateActiveNovel({ snowflakeMode: newMode });

      if (newMode) {
          showToast('已启用：雪花写作法 + 救猫咪节拍表', 'success');
          await sendMessage(`【系统指令】启动 高级创作引导模式 (Advanced Workflow)。
      
采用 **雪花写作法 (Snowflake Method)** 与 **救猫咪节拍表 (Save the Cat Beat Sheet)** 的组合策略。
**不允许单独使用其中一种，必须组合使用。**

- **组合逻辑**：
  1. 利用 **雪花写作法** 进行由简入繁的迭代式大纲构建（搭建骨架）。
  2. 利用 **救猫咪节拍表** (15个节奏点) 来卡死关键剧情节点（控制节奏），确保故事既严谨又不拖沓。

请引导我开始创作，第一步：请让我用一句话概括整个故事（包含主角、核心冲突和结局）。
请给出一个示例，并等待我的输入。`);
      } else {
          showToast('已关闭雪花写作法，恢复默认模式', 'info');
          await sendMessage(`【系统指令】退出雪花写作法模式，恢复默认的自由对话创作模式。请等待我的下一个指令。`);
      }
  };
  
  const handleDeconstructNovel = async (input: string) => {
      const newId = createNewNovel();
      const tempTitle = input.startsWith('http') ? '小说拆解分析' : `拆解：${cleanTitle(input)}`;
      renameNovel(newId, tempTitle);
      const analysisPrompt = `我希望你帮我拆解分析这本小说：${input}。\n\n重要提示：\n1. 作为一个 AI 模型，你无法直接访问互联网链接。\n2. 如果用户提供的是链接 (URL)，请尝试根据链接中的关键词（如书名拼音、ID）判断是哪本书。如果你知道这本书（如果是知名小说），请直接基于你的知识库进行分析。\n3. 如果你无法识别该链接或不认识这本书，请直接告诉用户：“我无法访问该链接，也不认识这本书，请您提供该书的简介或开头正文，我将为您分析。” 并停止后续生成。\n\n如果这本是你知道的书，请分析它的：\n1. 题材类型与核心爽点\n2. 主角人设与金手指\n3. 读者画像与文风特点（例如：番茄快节奏、起点慢热逻辑严密等）\n4. 典型的开篇套路\n\n分析完成后，请基于这种风格，为我创建一个新的小说大纲。请先给出分析结果。`;
      const initialMsg: Message = { id: Date.now().toString(), role: 'user', content: analysisPrompt, timestamp: Date.now() };
      setNovels(prev => prev.map(n => n.id === newId ? { ...n, messages: [initialMsg], title: tempTitle } : n));
      setTimeout(() => {
          setCurrentNovelId(newId);
          setIsStreaming(true);
          abortControllerRef.current = new AbortController();
          const aiMsgId = (Date.now() + 1).toString();
          const placeholder: Message = { id: aiMsgId, role: 'model', content: '', timestamp: Date.now() + 1 };
           setNovels(currentNovels => currentNovels.map(n => n.id === newId ? { ...n, messages: [initialMsg, placeholder] } : n));
           generateStreamResponse([initialMsg], initialMsg.content, DEFAULT_SETTINGS, undefined, (chunk) => {
                setNovels(prev => prev.map(n => {
                    if (n.id === newId) {
                        const newMsgs = [...n.messages];
                        newMsgs[newMsgs.length-1].content += chunk;
                        return { ...n, messages: newMsgs };
                    }
                    return n;
                }));
           }, abortControllerRef.current.signal).then(t => setIsStreaming(false));
       }, 100);
  };
  
  const handleDownloadAll = () => { /* ... */ };

  const handleChapterAction = async (action: 'optimize' | 'regenerate' | 'analyze', chapterTitle: string, content: string, messageId: string) => {
      if (isStreaming) return;
      if (action === 'analyze') { await sendMessage(`请分析以下章节：${chapterTitle}...\n${content}`); return; }
      
      let prompt = '';
      if (action === 'optimize') {
          prompt = `请优化润色以下章节：${chapterTitle}...\n${content}`;
      } else {
          // Regenerate - Stronger Word Count Enforcement
          prompt = `请完全重写这一章：${chapterTitle}。

【🔴 核心指令：强制字数达标】
目标字数：**${settings.targetWordsPerChapter} 字**。
请务必严格遵守此字数要求，宁可写长，不可写短。

【扩写指南】
1. **拒绝流水账**：严禁使用概括性语言跳过剧情。
2. **细节填充**：请通过大量的环境描写（光影/声音/气味）、细致的动作分解、以及深度的心理活动描写来充实篇幅。
3. **场景展开**：不要一笔带过，请将本章的关键冲突拆解为具体的画面和对话。

【排版要求】
1. 保持 Markdown 格式，标题为 \`## ${chapterTitle}\`。
2. **正文结束后**，请务必换行并输出 \`=== 章节分析 ===\`，然后按以下格式补充信息：
- **出场角色**：[列出角色名]
- **场景设定**：[时间、地点、氛围]
- **情节要点**：[简述本章发生的核心事件]
- **伏笔埋设**：[本章埋下的线索]
- **情感基调**：[例如：压抑、热血、悲伤]
- **虚实目标**：[实：具体动作目标 / 虚：心理动机]
- **短剧脚本提示词**：[生成本章高潮镜头的 AI 绘画提示词，英文，逗号分隔]`;
      }
      
      await executeOptimization(prompt, content, messageId, 'chapter');
  };

  const handleTextSelectionOptimize = async (text: string, fullContext: string, messageId: string) => {
      if (isStreaming) return;
      const prompt = `请优化润色以下选中的段落...\n${text}\n...`;
      await executeOptimization(prompt, text, messageId, 'selection');
  };

  const executeOptimization = async (prompt: string, originalContent: string, messageId: string, type: 'chapter' | 'selection') => {
      setIsStreaming(true);
      abortControllerRef.current = new AbortController();
      setOptState({ isOpen: true, type, targetMessageId: messageId, originalContent, newContent: '', fullOriginalText: messages.find(m => m.id === messageId)?.content || '' });
      try {
          const tempHistory = [...messages, { id: 'temp', role: 'user' as const, content: prompt, timestamp: Date.now() }];
          let generatedText = '';
          await generateStreamResponse(tempHistory, prompt, settings, activeNovel.contextSummary, (chunk) => {
              generatedText += chunk;
              setOptState(prev => prev ? { ...prev, newContent: generatedText } : null);
          }, abortControllerRef.current.signal);
          const cleanText = cleanAIResponse(generatedText);
          setOptState(prev => prev ? { ...prev, newContent: cleanText } : null);
      } catch (e: any) { /*...*/ } finally { setIsStreaming(false); abortControllerRef.current = null; }
  };

  const handleConfirmOptimization = (finalContent: string) => { 
     if (!optState) return;
     const { targetMessageId, originalContent, type, fullOriginalText } = optState;
     let newFullContent = fullOriginalText;
     if (type === 'chapter') {
         if (fullOriginalText.includes(originalContent)) newFullContent = fullOriginalText.replace(originalContent, finalContent);
         else newFullContent = finalContent;
     } else { newFullContent = fullOriginalText.replace(originalContent, finalContent); }
     handleMessageEdit(targetMessageId, newFullContent);
     setOptState(null);
  };

  const placeholderText = useMemo(() => {
     if (messages.length <= 1) return "输入你的想法...";
     return "输入你的想法，或选择上方的快捷回复...";
  }, [messages]);

  const handleBatchToC = async (count: number | 'custom') => {
      if (isStreaming) return;
      const num = count === 'custom' ? 0 : count; 
      // Force strict header "## 目录" so the parser finds it, and force list items so they aren't Chapters
      const prompt = `请基于当前故事背景，批量生成接下来的 ${num} 个章节的目录。
      【重要排版要求】
      1. 请务必以 \`## 目录\` 作为开头标题。
      2. 具体的章节列表请使用 Markdown 列表格式 (例如：1. 第X章 标题)。
      3. **严禁**在列表项中使用标题格式 (##)，否则会导致系统识别错误。
      4. 不要使用代码块。`;
      await sendMessage(prompt);
  };

  const handleBatchContent = async (count: number | 'custom') => {
      if (isStreaming) return;
      const num = typeof count === 'number' ? count : 0;
      if (num <= 0) return;

      const startMsg: Message = { id: Date.now().toString(), role: 'user', content: `【系统指令】开始批量生成接下来的 ${num} 个章节正文...`, timestamp: Date.now() };
      let currentHistory = [...messages, startMsg];
      updateMessages(currentHistory); 

      setIsStreaming(true); 
      
      try {
          // Prepare SKILL & MCP reminders
          const activeSkills = settings.skillItems.filter(s => s.isActive).map(s => `[${s.name}: ${s.content}]`).join('\n');
          const activeMCPs = settings.mcpItems.filter(m => m.isActive).map(m => `[${m.name}: ${m.content}]`).join('\n');
          
          for (let i = 1; i <= num; i++) {
              if (abortControllerRef.current?.signal.aborted) break;
              
              // --- Check Auto-Anchor Condition ---
              const currentChapters = novelStats.currentChapters; 
              // Re-calculate chapters count based on currentHistory to be more precise during batch
              let batchCurrentChapters = 0;
              currentHistory.forEach(m => {
                  if (m.role === 'model') {
                      const matches = m.content.match(/(^|\n)##\s*(第[0-9一二三四五六七八九十]+章\s*[^\n]*)/g);
                      if (matches) batchCurrentChapters += matches.length;
                  }
              });

              if (activeNovel.anchorConfig?.enabled && batchCurrentChapters >= activeNovel.anchorConfig.nextTrigger) {
                  // Execute Anchor
                  showToast(`自动触发剧情锚点 (第 ${batchCurrentChapters} 章)...`, "info");
                  
                  // Run Anchor and get updated history
                  const newHistory = await executeAnchor(currentHistory, true);
                  
                  // Update currentHistory to include anchor messages so next generation uses truncated context
                  currentHistory = newHistory;

                  // Update next trigger
                  const nextTrigger = activeNovel.anchorConfig.nextTrigger + activeNovel.anchorConfig.chapterInterval;
                  updateActiveNovel({ 
                      anchorConfig: { ...activeNovel.anchorConfig, nextTrigger } 
                  });

                  // Brief pause
                  await new Promise(r => setTimeout(r, 1000));
              }
              
              let skillReminder = "";
              if (activeSkills || activeMCPs) {
                  skillReminder = `\n【⚠️ 严格遵守以下设定与技能】\n${activeMCPs}\n${activeSkills}`;
              }

              const prompt = `请撰写当前目录中下一个尚未撰写的章节正文。

【🔴 核心指令：强制字数达标】
本章设定的目标字数为 **${settings.targetWordsPerChapter} 字**。
作为一个专业小说家，你必须确保输出的内容长度**达到或超过**这一标准。
请务必自行估算字数，如果发现字数不足，请继续扩写，不要草草结尾。

${skillReminder}

【排版要求】
1. 必须以 \`## 第X章 标题\` 开头 (请勿包含 (草稿) 或其他备注)。
2. **严禁**输出任何 "好的"、"这是正文" 等闲聊内容，直接输出小说内容。
3. **正文结束后**，请务必换行并输出 \`=== 章节分析 ===\`，然后按以下格式补充信息：
- **出场角色**：[列出角色名]
- **场景设定**：[时间、地点、氛围]
- **情节要点**：[简述本章发生的核心事件]
- **伏笔埋设**：[本章埋下的线索]
- **情感基调**：[例如：压抑、热血、悲伤]
- **虚实目标**：[实：具体动作目标 / 虚：心理动机]
- **短剧脚本提示词**：[生成本章高潮镜头的 AI 绘画提示词，英文，逗号分隔]`;
              
              const userMsg: Message = { id: Date.now().toString(), role: 'user', content: `(自动任务 ${i}/${num}) ${prompt}`, timestamp: Date.now() };
              currentHistory = [...currentHistory, userMsg];
              updateMessages(currentHistory);

              abortControllerRef.current = new AbortController();
              const aiMsgId = (Date.now() + 1).toString();
              const aiMsgPlaceholder: Message = { id: aiMsgId, role: 'model', content: '', timestamp: Date.now() + 1 };
              currentHistory = [...currentHistory, aiMsgPlaceholder];
              
              // Initial update for placeholder
              updateMessages(currentHistory);
              
              let fullResponse = '';
              let lastUpdateTime = 0;

              await generateStreamResponse(currentHistory.slice(0, -1), prompt, settings, activeNovel.contextSummary, (chunk) => {
                      fullResponse += chunk;
                      // Throttling for batch generation as well to save memory/CPU
                      const now = Date.now();
                      if (now - lastUpdateTime > 200) { // Slightly more aggressive throttling for batch (200ms)
                          updateMessagesThrottled(activeNovel.id, aiMsgId, fullResponse);
                          lastUpdateTime = now;
                      }
                  }, abortControllerRef.current.signal);
              
              // Final update
              updateMessagesThrottled(activeNovel.id, aiMsgId, fullResponse);

              const cleanFullResponse = cleanAIResponse(fullResponse);
              const contentWithOptions = cleanFullResponse + "\n\nOptions: [继续写下一章] [重写本章] [精修本章] [生成本章细纲]";
              currentHistory[currentHistory.length - 1] = { ...aiMsgPlaceholder, content: contentWithOptions };
              updateMessages(currentHistory);
              await new Promise(r => setTimeout(r, 1000));
          }
      } catch (e) { console.error("Batch error", e); } finally { setIsStreaming(false); abortControllerRef.current = null; }
  };

  const siteName = activeNovel.settings?.siteSettings?.siteName || 'InkFlow';

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-black ec:bg-ec-bg text-gray-900 dark:text-gray-100 ec:text-ec-text font-sans transition-colors relative">
      
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
          {toasts.map(toast => (
              <div key={toast.id} className={`toast-enter pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2
                  ${toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : ''}
                  ${toast.type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' : ''}
                  ${toast.type === 'info' ? 'bg-indigo-100 text-indigo-800 border border-indigo-200' : ''}
              `}>
                  {toast.type === 'success' && <span>✅</span>}
                  {toast.type === 'error' && <span>⚠️</span>}
                  {toast.type === 'info' && <span className="animate-spin">⏳</span>}
                  {toast.message}
              </div>
          ))}
      </div>

      <header className="h-16 border-b border-gray-200 dark:border-gray-800 ec:border-ec-border flex items-center justify-between px-4 lg:px-6 bg-white dark:bg-gray-900 ec:bg-ec-surface shrink-0 z-10 transition-colors">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white shadow-md">Ink</div>
                <div className="flex flex-col justify-center">
                    <h1 className="font-bold text-lg tracking-tight hidden md:flex items-center gap-1 ec:text-ec-text leading-tight">
                        {siteName}
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500 dark:text-gray-400 font-medium ml-1">v1.7.2</span>
                    </h1>
                    {activeNovel.settings?.siteSettings?.siteDescription && (
                        <span className="text-xs text-gray-500 ec:text-ec-text hidden md:block leading-tight">{activeNovel.settings.siteSettings.siteDescription}</span>
                    )}
                </div>
            </div>
            <div className="hidden lg:flex items-center gap-3 px-4 py-1.5 bg-gray-100 dark:bg-gray-800 ec:bg-ec-bg rounded-full text-base text-gray-600 dark:text-gray-300 ec:text-ec-text border border-gray-200 dark:border-gray-700 ec:border-ec-border">
                <input type="text" value={activeNovel.title} onChange={(e) => updateActiveNovel({ title: e.target.value })} className="font-bold text-indigo-600 dark:text-indigo-400 ec:text-ec-accent bg-transparent border-none focus:outline-none focus:ring-0 w-[150px] truncate hover:bg-gray-200 dark:hover:bg-gray-700 ec:hover:bg-ec-surface rounded px-1 transition-colors"/>
                <span className="w-px h-3 bg-gray-300 dark:bg-gray-600 ec:bg-ec-border"></span>
                <button onClick={() => setIsSettingsOpen(true)} className="hover:text-indigo-600 dark:hover:text-indigo-400 ec:hover:text-ec-accent">章节: {novelStats.currentChapters}/{novelStats.totalChapters}</button>
                <span className="w-px h-3 bg-gray-300 dark:bg-gray-600 ec:bg-ec-border"></span>
                <span>正文字数: {(novelStats.wordCount / 10000).toFixed(1)}万</span>
            </div>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 ec:bg-ec-bg p-1 rounded-lg">
             <button onClick={() => setViewMode(ViewMode.ChatOnly)} className={`p-2 rounded-md ${viewMode===ViewMode.ChatOnly?'bg-white dark:bg-gray-700 ec:bg-ec-surface shadow-sm':''}`}><MessageSquareIcon /></button>
             <button onClick={() => setViewMode(ViewMode.Split)} className={`p-2 rounded-md ${viewMode===ViewMode.Split?'bg-white dark:bg-gray-700 ec:bg-ec-surface shadow-sm':''}`}><div className="flex gap-0.5"><div className="w-2 h-3 border border-current rounded-[1px]"></div><div className="w-2 h-3 border border-current rounded-[1px] bg-current"></div></div></button>
             <button onClick={() => setViewMode(ViewMode.NovelOnly)} className={`p-2 rounded-md ${viewMode===ViewMode.NovelOnly?'bg-white dark:bg-gray-700 ec:bg-ec-surface shadow-sm':''}`}><BookOpenIcon /></button>
        </div>
        <div className="flex items-center gap-2">
            {/* Snowflake Toggle Button */}
            <button 
                onClick={handleSnowflakeToggle} 
                disabled={isStreaming} 
                className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-base font-bold rounded-lg transition-colors border shadow-sm ${
                    activeNovel.snowflakeMode 
                    ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800' 
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 ec:bg-ec-bg ec:text-ec-text'
                }`} 
                title={activeNovel.snowflakeMode ? "点击关闭雪花写作法" : "点击开启雪花写作法 (Snowflake + Save the Cat)"}
            >
                <SparklesIcon /> {activeNovel.snowflakeMode ? '雪花法 (已开启)' : '雪花法'}
            </button>

            {/* Anchor Button */}
            {messages.length > 5 && (
                 <button 
                    onClick={handleAnchorClick} 
                    disabled={isStreaming} 
                    className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-base font-bold rounded-lg transition-colors border shadow-sm ${
                        activeNovel.anchorConfig?.enabled 
                        ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800' 
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 ec:bg-ec-bg ec:text-ec-text'
                    }`} 
                    title="压缩上下文：将当前剧情总结为锚点，释放Token空间，防止生成中断。"
                >
                    <span>⚓</span> {activeNovel.anchorConfig?.enabled ? `自动锚定` : '剧情锚点'}
                </button>
            )}
            <button onClick={() => setIsLibraryOpen(true)} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-base font-medium bg-gray-100 dark:bg-gray-800 ec:bg-ec-bg rounded-lg ec:text-ec-text"><LibraryIcon /> 图书库</button>
            <button onClick={handleDownloadAll} className="p-2 rounded-lg sm:hidden">⬇️</button>
            
            {/* Theme Toggle */}
            <button onClick={toggleTheme} className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 ec:text-ec-text ec:hover:text-black transition-colors" title="切换主题: 白天/暗黑">
                {theme === 'light' ? <SunIcon /> : <MoonIcon />}
            </button>
            
            <button onClick={() => setIsContactOpen(true)} className="p-2 text-gray-500 ec:text-ec-text"><MailIcon /></button>
            <button onClick={() => setIsHelpOpen(true)} className="p-2 text-gray-500 ec:text-ec-text"><HelpCircleIcon /></button>
            <button onClick={() => setIsVersionOpen(true)} className="p-2 text-gray-500 ec:text-ec-text"><HistoryIcon /></button>
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-gray-100 dark:bg-gray-800 ec:bg-ec-bg rounded-lg ec:text-ec-text"><SettingsIcon /></button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative flex ec:bg-ec-bg">
        {/* Adjusted Width: w-[40%] for Chat Area */}
        <div className={`flex-1 h-full transition-all ${viewMode === ViewMode.NovelOnly ? 'hidden' : 'block'} ${viewMode === ViewMode.Split ? 'w-[40%] border-r border-gray-200 dark:border-gray-800 ec:border-ec-border' : 'w-full'}`}>
          <ChatArea messages={messages} input={inputValue} isStreaming={isStreaming && !optState?.isOpen} placeholderText={placeholderText} onInputChange={handleInputChange} onSend={handleUserSend} onStop={handleStop} onMessageEdit={handleMessageEdit} onSummarize={handleSummarize} onShowToast={showToast} />
        </div>
        {/* Adjusted Width: w-[60%] for Novel View */}
        <div className={`h-full transition-all bg-white dark:bg-gray-950 ec:bg-ec-bg ${viewMode === ViewMode.ChatOnly ? 'hidden' : 'block'} ${viewMode === ViewMode.Split ? 'w-[60%]' : 'w-full'}`}>
           <NovelView messages={messages} settings={settings} onBatchGenerateToC={handleBatchToC} onBatchGenerateContent={handleBatchContent} onChapterAction={handleChapterAction} onTextSelectionOptimize={handleTextSelectionOptimize} isGenerating={isStreaming} onMessageEdit={handleMessageEdit} />
        </div>
      </main>

      {/* Floating Action Button for Contact */}
      <button 
        onClick={() => setIsContactOpen(true)} 
        className="fixed bottom-20 right-4 p-3 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-transform hover:scale-105 z-40"
        title="联系开发者"
      >
        <UserIcon />
      </button>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onSave={updateSettings} />
      <LibraryModal isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} novels={novels} currentNovelId={currentNovelId} onSelectNovel={(id) => {setCurrentNovelId(id); setIsLibraryOpen(false);}} onCreateNovel={createNewNovel} onDeleteNovel={deleteNovel} onRenameNovel={renameNovel} onDeconstructNovel={handleDeconstructNovel} />
      
      <AnchorModal 
        isOpen={isAnchorModalOpen} 
        onClose={() => setIsAnchorModalOpen(false)} 
        currentConfig={activeNovel.anchorConfig}
        currentChapterCount={novelStats.currentChapters}
        onExecuteNow={() => executeAnchor()}
        onSaveConfig={(config) => updateActiveNovel({ anchorConfig: config })}
      />

      {optState && <ComparisonModal isOpen={optState.isOpen} onClose={() => { if (isStreaming) handleStop(); setOptState(null); }} title={optState.type === 'chapter' ? '章节重写/优化' : '段落润色'} oldContent={optState.originalContent} newContent={optState.newContent} onConfirm={handleConfirmOptimization} isApplying={false} isStreaming={isStreaming} />}
      
      {/* Contact Modal with Fixed WeChat QR */}
      {isContactOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-gray-900 ec:bg-ec-bg border ec:border-ec-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100">
                  <div className="p-4 border-b ec:border-ec-border flex justify-between bg-gray-50 dark:bg-gray-900 ec:bg-ec-surface">
                      <h3 className="ec:text-ec-text font-bold text-lg">加入官方交流群</h3>
                      <button onClick={() => setIsContactOpen(false)} className="ec:text-ec-text hover:rotate-90 transition-transform"><XIcon/></button>
                  </div>
                  <div className="p-8 text-center ec:text-ec-text flex flex-col items-center gap-5">
                      <div className="relative group">
                          <div className="absolute -inset-1 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
                          <img src="images/weixin.jpg" alt="WeChat QR" className="relative w-48 h-48 object-cover border-4 border-white dark:border-gray-800 rounded-lg shadow-sm" />
                      </div>
                      <div className="space-y-1">
                          <p className="text-sm font-bold text-gray-800 dark:text-white">扫码添加开发者好友</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">备注 <span className="text-indigo-600 font-bold">"InkFlow"</span>，邀请进入微信群</p>
                      </div>
                      <div className="w-full h-px bg-gray-100 dark:bg-gray-800"></div>
                      <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 ec:text-ec-accent text-sm">
                          <MailIcon/>
                          <a href="mailto:lyjhxf@126.com" className="hover:underline">lyjhxf@126.com</a>
                      </div>
                  </div>
              </div>
          </div>
      )}
      
      {/* First Time Welcome Modal (Step-by-Step Guide) */}
      {isWelcomeOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
              <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-8 text-center space-y-6 border border-gray-200 dark:border-gray-800 relative">
                  
                  {/* Step Indicators */}
                  <div className="flex justify-center gap-2 mb-4">
                      {welcomeSteps.map((_, idx) => (
                          <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 ${idx === welcomeStep ? 'w-8 bg-indigo-600' : 'w-2 bg-gray-200 dark:bg-gray-700'}`} />
                      ))}
                  </div>

                  <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto text-4xl mb-4 transition-transform duration-500 hover:scale-110">
                      {welcomeSteps[welcomeStep].icon}
                  </div>
                  
                  <div className="space-y-3 min-h-[120px]">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white transition-opacity duration-300">{welcomeSteps[welcomeStep].title}</h2>
                      <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed px-2">
                          {welcomeSteps[welcomeStep].content}
                      </p>
                  </div>

                  <div className="flex gap-3 pt-4">
                      {welcomeStep > 0 && (
                          <button 
                              onClick={() => setWelcomeStep(s => s - 1)}
                              className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                          >
                              上一步
                          </button>
                      )}
                      <button 
                          onClick={() => {
                              if (welcomeStep < welcomeSteps.length - 1) {
                                  setWelcomeStep(s => s + 1);
                              } else {
                                  setIsWelcomeOpen(false);
                              }
                          }}
                          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02]"
                      >
                          {welcomeStep < welcomeSteps.length - 1 ? '下一步' : '开始创作'}
                      </button>
                  </div>
                  
                  <button onClick={() => setIsWelcomeOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                      <XIcon />
                  </button>
              </div>
          </div>
      )}

      {/* Help Modal */}
      {isHelpOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-900 ec:bg-ec-bg border ec:border-ec-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
               <div className="p-4 border-b border-gray-200 dark:border-gray-700 ec:border-ec-border flex justify-between bg-gray-50 dark:bg-gray-900 ec:bg-ec-surface">
                   <h3 className="font-bold text-gray-900 dark:text-white ec:text-ec-text text-lg">📚 InkFlow 使用全指南 (User Guide)</h3>
                   <button onClick={() => setIsHelpOpen(false)} className="ec:text-ec-text"><XIcon/></button>
               </div>
               <div className="p-8 overflow-y-auto space-y-8 text-sm text-gray-600 dark:text-gray-300 ec:text-ec-text leading-relaxed">
                  
                  <section className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800 flex items-start gap-4">
                      <img src="images/weixin.jpg" alt="WeChat QR" className="w-24 h-24 object-cover rounded-lg shrink-0 border" />
                      <div>
                          <h4 className="font-bold text-indigo-700 dark:text-indigo-300 text-base mb-1">加入官方交流群</h4>
                          <p className="text-gray-600 dark:text-gray-300 mb-2">扫描左侧二维码添加开发者好友，备注 "InkFlow"，邀请您进入微信交流群，获取最新更新与写作技巧。</p>
                      </div>
                  </section>

                  <section>
                    <h4 className="font-bold text-gray-900 dark:text-white ec:text-ec-text mb-3 text-base flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-800 ec:border-ec-border">
                        <span className="text-xl">🚀</span> 快速开始 (Quick Start)
                    </h4>
                    <ol className="list-decimal list-inside space-y-3">
                        <li><strong>初始化</strong>：在对话框输入想写的故事类型（如“修仙”、“都市”）。AI 会引导你确认【书名】、【世界观】和【核心梗概】。</li>
                        <li><strong>参数配置</strong>：点击右上角 <SettingsIcon/>，设置【API Key】（支持 OpenAI/DeepSeek 等）、【总章节数】和【单章字数】。</li>
                        <li><strong>生成大纲</strong>：让 AI 生成角色档案、势力设定和章节大纲。这些内容会自动归档到顶部的“数据库”和“章节”标签页中。</li>
                        <li><strong>批量写作</strong>：在“章节正文”页底部，点击【生成目录】 &rarr; 【撰写 X 章】，AI 将自动连续创作。</li>
                    </ol>
                  </section>

                  <section>
                      <h4 className="font-bold text-gray-900 dark:text-white ec:text-ec-text mb-3 text-base flex items-center gap-2 border-b pb-2 border-gray-100 dark:border-gray-800 ec:border-ec-border">
                          <span className="text-xl">⚡</span> 高级功能 (Pro Features)
                      </h4>
                      <ul className="space-y-4">
                          <li className="flex gap-3">
                              <div className="mt-1"><SparklesIcon /></div>
                              <div>
                                  <strong className="text-gray-900 dark:text-white ec:text-ec-text">组合写作法 (Snowflake + Save the Cat)</strong>
                                  <p className="mt-1 opacity-90">点击右上角的 <span className="text-green-600 font-bold">❄️ 雪花法</span> 按钮开启。开启后，系统将强制使用“雪花法迭代框架”配合“救猫咪节拍表”进行创作，适合构建严谨的长篇大纲。</p>
                              </div>
                          </li>
                          <li className="flex gap-3">
                              <div className="mt-1">⚓</div>
                              <div>
                                  <strong className="text-gray-900 dark:text-white ec:text-ec-text">剧情锚点 (Context Anchor)</strong>
                                  <p className="mt-1 opacity-90">解决长文遗忘问题。点击 <span className="text-indigo-600 font-bold">⚓ 剧情锚点</span> 可手动压缩上下文。也可在弹窗中开启“自动锚定”，每写 20 章自动触发一次。</p>
                              </div>
                          </li>
                          <li className="flex gap-3">
                              <div className="mt-1">📚</div>
                              <div>
                                  <strong className="text-gray-900 dark:text-white ec:text-ec-text">知识库与技能 (MCP & SKILL)</strong>
                                  <p className="mt-1 opacity-90">在设置中添加【MCP 知识库】（如“世界观设定”）或【SKILL 技能】（如“环境描写要求”）。这些内容会作为系统指令实时注入，确保 AI 始终遵循设定。</p>
                              </div>
                          </li>
                      </ul>
                  </section>
               </div>
            </div>
          </div>
      )}

      {/* Version History Modal */}
      {isVersionOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-900 ec:bg-ec-bg border ec:border-ec-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
               <div className="p-4 border-b border-gray-200 dark:border-gray-700 ec:border-ec-border flex justify-between bg-gray-50 dark:bg-gray-900 ec:bg-ec-surface">
                   <h3 className="font-bold text-gray-900 dark:text-white ec:text-ec-text flex items-center gap-2"><HistoryIcon /> 版本历史 (Changelog)</h3>
                   <button onClick={() => setIsVersionOpen(false)} className="ec:text-ec-text"><XIcon/></button>
               </div>
               <div className="p-6 overflow-y-auto custom-scrollbar">
                   <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ec:border-ec-border ml-3 space-y-8">
                       
                        {/* v1.7.2 */}
                       <div className="relative pl-6">
                           <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-indigo-500 border-4 border-white dark:border-gray-900 ec:border-ec-bg"></div>
                           <div className="flex flex-col gap-1">
                               <div className="flex items-center gap-2">
                                   <h4 className="font-bold text-gray-900 dark:text-white ec:text-ec-text">v1.7.2 - 沉浸式创作与分析</h4>
                                   <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] rounded-full font-bold">Latest</span>
                               </div>
                               <span className="text-xs text-gray-400 mb-2">2026-02-06</span>
                               <ul className="text-sm text-gray-600 dark:text-gray-300 ec:text-ec-text space-y-1.5 list-disc list-inside">
                                   <li>🧹 <strong>聊天区净化</strong>：生成正文时自动折叠聊天消息，仅显示生成状态，保持界面清爽。</li>
                                   <li>📊 <strong>章节深度分析</strong>：新增正文后自动生成“角色/场景/伏笔/情感/短剧Prompt”等多维分析看板。</li>
                                   <li>⚡ <strong>批量生成优化</strong>：提升了批量生成时的上下文连贯性。</li>
                               </ul>
                           </div>
                       </div>

                       {/* v1.7.1 */}
                       <div className="relative pl-6">
                           <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-gray-400 border-4 border-white dark:border-gray-900 ec:border-ec-bg"></div>
                           <div className="flex flex-col gap-1">
                               <div className="flex items-center gap-2">
                                   <h4 className="font-bold text-gray-900 dark:text-white ec:text-ec-text">v1.7.1 - 核心修复与严格模式</h4>
                               </div>
                               <span className="text-xs text-gray-400 mb-2">2026-02-06</span>
                               <ul className="text-sm text-gray-600 dark:text-gray-300 ec:text-ec-text space-y-1.5 list-disc list-inside">
                                   <li>🐛 修复编辑功能保存问题。</li>
                                   <li>🛑 强制 AI 严格遵守字数设定。</li>
                                   <li>🧠 增强知识库注入逻辑。</li>
                               </ul>
                           </div>
                       </div>

                       {/* v1.7.0 */}
                       <div className="relative pl-6">
                           <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-gray-400 border-4 border-white dark:border-gray-900 ec:border-ec-bg"></div>
                           <div className="flex flex-col gap-1">
                               <div className="flex items-center gap-2">
                                   <h4 className="font-bold text-gray-900 dark:text-white ec:text-ec-text">v1.7.0 - 社群与体验升级</h4>
                               </div>
                               <span className="text-xs text-gray-400 mb-2">2026-02-05</span>
                               <ul className="text-sm text-gray-600 dark:text-gray-300 ec:text-ec-text space-y-1.5 list-disc list-inside">
                                   <li>👥 新增官方微信群入口。</li>
                                   <li>🎈 新增新手引导。</li>
                               </ul>
                           </div>
                       </div>

                   </div>
               </div>
            </div>
          </div>
      )}
    </div>
  );
}

export default App;