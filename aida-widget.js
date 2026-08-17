// AIDA AI Widget — Chat + Voice (Gemini Live)
// Подключается к smit34_index.html через <script type="text/babel" src="aida-widget.js">
// Зависимости: React (useState, useEffect, useRef), Icons (Bot, X, Phone, Mic, Square, Loader2, ArrowRight)
// Все зависимости берутся из глобального scope (определены в основном скрипте)

// --- ГОЛОСОВОЙ AI АССИСТЕНТ ---
let GEMINI_API_KEY = '';
// Загружаем ключ с сервера (не хардкодим в HTML)
fetch('https://aida.smit34.ru/api/gemini-key')
    .then(r => r.json())
    .then(d => { if (d.key) GEMINI_API_KEY = d.key; })
    .catch(() => {});

// Audio Utils
function floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return new Uint8Array(output.buffer);
}

function base64Encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64Decode(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(data, ctx, sampleRate = 24000, numChannels = 1) {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

const CHAT_STORAGE_KEY = 'smit_chat_history';
const CHAT_TTL_MS = 12 * 60 * 60 * 1000;
const INITIAL_GREETING = 'Привет! Я Аида — ваш ИИ-ассистент. Помогу выбрать тариф, расскажу об услугах или оформлю заявку на подключение. Если вы наш клиент и у вас проблемы, тоже могу помочь!';
const INITIAL_SUGGESTIONS = [
    'Хочу подключить интернет 🌐',
    'Уже клиент, есть проблема 🔧',
    'Цена подключения 💰',
];

function renderMd(text) {
    const html = text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');
    return html.split('\n').map((line, i) =>
        line.trim()
            ? React.createElement('p', { key: i, className: 'mb-1 last:mb-0', dangerouslySetInnerHTML: { __html: line } })
            : React.createElement('div', { key: i, className: 'h-1' })
    );
}

function AIWidget() {
    const { useState, useEffect, useRef } = React;

    // Chat state
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState('chat');
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem(CHAT_STORAGE_KEY);
            if (saved) {
                const { messages: savedMsgs, timestamp } = JSON.parse(saved);
                if (Date.now() - timestamp < CHAT_TTL_MS && savedMsgs?.length > 0) {
                    return savedMsgs;
                }
                localStorage.removeItem(CHAT_STORAGE_KEY);
            }
        } catch (e) {}
        return [{role:'bot', text: INITIAL_GREETING}];
    });
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [suggestions, setSuggestions] = useState(() => {
        try {
            const saved = localStorage.getItem(CHAT_STORAGE_KEY);
            if (saved) {
                const { messages: savedMsgs, timestamp } = JSON.parse(saved);
                if (Date.now() - timestamp < CHAT_TTL_MS && savedMsgs?.length > 1) {
                    return [];
                }
            }
        } catch (e) {}
        return INITIAL_SUGGESTIONS;
    });
    const messagesEndRef = useRef(null);
    const [sessionId] = useState(() => {
        const stored = localStorage.getItem('smit_session_id');
        if (stored) return stored;
        const id = `widget_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        localStorage.setItem('smit_session_id', id);
        return id;
    });

    // Save messages to localStorage on change
    useEffect(() => {
        if (messages.length > 1) {
            try {
                localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
                    messages,
                    timestamp: Date.now()
                }));
            } catch (e) {}
        }
    }, [messages]);

    // Geolocation state
    const [showGeoBtn, setShowGeoBtn] = useState(false);
    const [geoLoading, setGeoLoading] = useState(false);

    // Phone mask state
    const [phoneMode, setPhoneMode] = useState(false);
    const inputRef = useRef(null);

    const formatPhone = (digits) => {
        let r = '+7(';
        for (let i = 0; i < digits.length && i < 10; i++) {
            if (i === 3) r += ') ';
            if (i === 6) r += '-';
            if (i === 8) r += '-';
            r += digits[i];
        }
        return r;
    };

    const handlePhoneInput = (e) => {
        const raw = e.target.value.replace(/\D/g, '');
        let digits = raw;
        if (digits.startsWith('7')) digits = digits.substring(1);
        else if (digits.startsWith('8')) digits = digits.substring(1);
        if (digits.length > 10) digits = digits.substring(0, 10);
        setInput(formatPhone(digits));
    };

    const handlePhoneKeyDown = (e) => {
        if (['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter'].includes(e.key)) {
            if (e.key === 'Backspace') {
                const raw = input.replace(/\D/g, '');
                let digits = raw;
                if (digits.startsWith('7')) digits = digits.substring(1);
                else if (digits.startsWith('8')) digits = digits.substring(1);
                if (digits.length === 0) { e.preventDefault(); return; }
            }
            return;
        }
        if (e.ctrlKey || e.metaKey) return;
        if (!/^\d$/.test(e.key)) { e.preventDefault(); return; }
        const raw = input.replace(/\D/g, '');
        let digits = raw;
        if (digits.startsWith('7')) digits = digits.substring(1);
        else if (digits.startsWith('8')) digits = digits.substring(1);
        if (digits.length >= 10) e.preventDefault();
    };

    const checkPhoneQuestion = (text) => {
        const lo = text.toLowerCase().replace(/\*\*/g, '').replace(/<[^>]*>/g, '');
        const kw = ['номер телефона', 'ваш телефон', 'телефон для связи',
                    'контактный телефон', 'номер для связи', 'ваш номер',
                    'введите.*телефон', 'укажите.*телефон', 'подскажите.*телефон',
                    'оставьте.*телефон', 'номер.*для связи',
                    'укажите его в формате \\+7', 'формате \\+79',
                    'нужен.*номер.*телефон', 'мне нужен ваш номер'];
        // Исключения: фразы означающие что бот УЖЕ ПОЛУЧИЛ номер (не просит)
        const ex = ['номер принят', 'телефон принят', 'телефон записал',
                    'номер записал', 'нашёл.*по номеру', 'нашел.*по номеру',
                    'найден по номеру', 'абонент.*найден',
                    'по номеру.*найден', 'с номером.*найден'];
        const hasKw = kw.some(k => new RegExp(k, 'i').test(lo));
        const hasEx = ex.some(k => new RegExp(k, 'i').test(lo));
        return hasKw && !hasEx;
    };

    const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;

    // Device info (отправляется один раз при первом сообщении)
    const deviceInfoSent = useRef(false);
    const getDeviceInfo = () => {
        const ua = navigator.userAgent;
        let dtype = 'Desktop';
        if (/iPhone|iPad|iPod/i.test(ua)) dtype = 'iOS';
        else if (/Android/i.test(ua)) dtype = 'Android';
        else if (/Mac/i.test(ua)) dtype = 'Mac';
        else if (/Windows/i.test(ua)) dtype = 'Windows PC';
        else if (/Linux/i.test(ua)) dtype = 'Linux';

        let os = '';
        const osM = ua.match(/\(([^)]+)\)/);
        if (osM) os = osM[1].split(';')[0].trim();

        let browser = '';
        if (/Edg\//i.test(ua)) browser = 'Edge ' + (ua.match(/Edg\/([\d.]+)/)||[])[1];
        else if (/YaBrowser/i.test(ua)) browser = 'Yandex ' + (ua.match(/YaBrowser\/([\d.]+)/)||[])[1];
        else if (/OPR|Opera/i.test(ua)) browser = 'Opera';
        else if (/Chrome\//i.test(ua)) browser = 'Chrome ' + (ua.match(/Chrome\/([\d.]+)/)||[])[1];
        else if (/Firefox\//i.test(ua)) browser = 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)||[])[1];
        else if (/Safari\//i.test(ua)) browser = 'Safari ' + (ua.match(/Version\/([\d.]+)/)||[])[1];

        return {
            device_type: dtype, device_os: os, device_browser: browser,
            device_screen: `${screen.width}x${screen.height}`, device_ip: ''
        };
    };

    // UTM capture — извлекаем из URL и сохраняем в localStorage
    const getUtmParams = () => {
        try {
            const params = new URLSearchParams(window.location.search);
            const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
            const utm = {};
            keys.forEach(k => { if (params.get(k)) utm[k] = params.get(k); });
            if (Object.keys(utm).length > 0) localStorage.setItem('aida_utm_params', JSON.stringify(utm));
            const stored = JSON.parse(localStorage.getItem('aida_utm_params') || '{}');
            return Object.keys(stored).length > 0 ? stored : {};
        } catch(e) { return {}; }
    };
    const utmParams = getUtmParams();

    const getAddressFromCoords = async (lat, lon) => {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ru`;
        const resp = await fetch(url, { headers: { "User-Agent": "SMIT-Widget/1.0" } });
        if (!resp.ok) throw new Error("Geocoding error");
        const data = await resp.json();
        if (!data || !data.address) throw new Error("No address");
        const a = data.address;
        const parts = [];
        const city = a.city || a.town || a.village || a.hamlet || a.municipality;
        if (city) parts.push(city.replace(/^город\s+/i, "").replace(/^г\.\s*/i, ""));
        const street = a.road || a.street;
        if (street) {
            let st = street, tp = "ул.";
            if (/^проспект\s/i.test(st)) tp = "пр.";
            else if (/^переулок\s/i.test(st)) tp = "пер.";
            else if (/^бульвар\s/i.test(st)) tp = "б-р";
            else if (/^шоссе\s/i.test(st)) tp = "ш.";
            st = st.replace(/^(улица|ул\.|проспект|пр\.|переулок|пер\.|бульвар|б-р|проезд|шоссе)\s+/i, "");
            parts.push(tp + " " + st);
        }
        if (a.house_number) parts.push("д. " + a.house_number);
        return parts.length > 0 ? parts.join(", ") : data.display_name;
    };

    const handleGeolocate = () => {
        if (!navigator.geolocation) return;
        setGeoLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const addr = await getAddressFromCoords(pos.coords.latitude, pos.coords.longitude);
                    setInput(addr + ", кв. ");
                    setShowGeoBtn(false);
                } catch { setGeoLoading(false); }
                setGeoLoading(false);
            },
            () => { setGeoLoading(false); },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    // Voice state
    const [isActive, setIsActive] = useState(false);
    const [status, setStatus] = useState('idle');
    const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
    const [error, setError] = useState(null);
    const [micError, setMicError] = useState(false);

    const audioContextRef = useRef(null);
    const inputContextRef = useRef(null);
    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef(new Set());
    const processorRef = useRef(null);
    const streamRef = useRef(null);
    const sessionRef = useRef(null);
    const activeConnectionIdRef = useRef(null);
    const shouldReconnectRef = useRef(false);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimeoutRef = useRef(null);
    const voiceTranscriptRef = useRef([]);
    const voiceCurrentBotRef = useRef('');
    const userInputAccumulatorRef = useRef('');
    const billingCheckedRef = useRef(false);

    const cleanupResources = () => {
        activeConnectionIdRef.current = null;
        if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (inputContextRef.current) { inputContextRef.current.close(); inputContextRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
        if (sessionRef.current) { sessionRef.current = null; }
        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();
        setIsAgentSpeaking(false);
        nextStartTimeRef.current = 0;
    };

    const stop = () => {
        shouldReconnectRef.current = false;
        reconnectAttemptsRef.current = 0;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

        // Прямое создание тикета/лида из голосового транскрипта
        const transcript = voiceTranscriptRef.current;
        if (transcript.length > 0) {
            const botMsgs = transcript.filter(m => m.role === 'bot');
            const confirmMsg = botMsgs.slice().reverse().find(m => {
                const t = m.text.toLowerCase();
                return (t.includes('верн') || t.includes('данные') || t.includes('повтор') || t.includes('обращение') || t.includes('поддержк')) &&
                       (t.includes('тариф') || t.includes('номер') || t.includes('телефон') || t.includes('адрес') || t.includes('имя') || t.includes('проблем'));
            }) || (botMsgs.length >= 2 ? botMsgs[botMsgs.length - 2] : botMsgs[botMsgs.length - 1]);

            if (confirmMsg) {
                const raw = confirmMsg.text.replace(/\s+/g, ' ').trim();
                console.log('[Voice ticket] raw confirmMsg:', raw.slice(0, 200));

                const nameM  = raw.match(/Имя:\s*([А-ЯЁа-яё][а-яё]+)/i)
                            || raw.match(/(?:зовут\s*|заявки:\s*)([А-ЯЁа-яё][а-яё]+)/i)
                            || raw.match(/^([А-ЯЁ][а-яё]{2,}),\s*(?:телефон|номер)/i)
                            || raw.match(/(?:\d[\d\s\-]+,\s*)([А-ЯЁа-яё][а-яё]{2,})/i);
                const phoneM = raw.match(/[Тт]елефон[:\s]+(\+?[\d][\d\s\-\(\)]{8,14})/i)
                            || raw.match(/(\+?[78][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/);
                const addrM  = raw.match(/[Аа]дрес:\s*(.+?)(?:,\s*(?:[Тт]ариф|[Тт]елефон|[Ии]мя|[Пп]роблема)|[.]\s*[А-ЯЁ]|$)/i)
                            || raw.match(/адрес[:\s]+(.+?)(?:,?\s*(?:тариф|телефон|номер|всё|все|подтверж|проблем))/i);
                const tariffM = raw.match(/Тариф:\s*[«"]?([^»".,\n]+)/i)
                            || raw.match(/«([^»]+)»/);
                const problemM = raw.match(/[Пп]роблем[аы]?:\s*(.+?)(?:[.]\s*[А-ЯЁ]|[.]\s*$|\s*[Вв]сё верно|\s*[Сс]оздаю|$)/i)
                              || raw.match(/проблем[аы]?[:\s]+(.+?)(?:[.]\s|$)/i);

                const name   = nameM   ? nameM[1].trim()   : '';
                const phone  = phoneM  ? phoneM[1].trim()  : '';
                const addr   = addrM   ? addrM[1].trim()   : '';
                const tariff = tariffM ? tariffM[1].trim() : '';
                const problem = problemM ? problemM[1].trim() : '';

                // Parse referrer ("как узнали") from transcript
                let referrer = '';
                const allMsgs = transcript.map(m => ({role: m.role, text: (m.text||'').toLowerCase()}));
                const refIdx = allMsgs.findIndex(m => m.role === 'bot' && (m.text.includes('как вы о нас узнали') || m.text.includes('откуда узнали') || m.text.includes('как узнали')));
                if (refIdx >= 0) {
                    const nextUser = allMsgs.slice(refIdx + 1).find(m => m.role === 'user');
                    if (nextUser) referrer = nextUser.text.trim();
                }

                console.log('[Voice ticket] parsed:', { name, phone, addr, tariff, problem });

                if (name || phone) {
                    // 1. Сохраняем транскрипт голосовой сессии в БД
                    const devInfo = getDeviceInfo();
                    fetch('https://aida.smit34.ru/api/voice-save-transcript', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: sessionId,
                            transcript: transcript,
                            ...devInfo,
                            ...utmParams
                        })
                    })
                    .then(r => r.json())
                    .then(saveData => {
                        console.log('[Voice transcript] saved:', saveData);
                        const aidaConvId = saveData.success ? saveData.conversation_id : null;
                        // 2. Создаём тикет с привязкой к AI-сессии
                        return fetch('https://aida.smit34.ru/api/voice-create-ticket', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name, phone, address: addr, problem, tariff,
                                aida_conversation_id: aidaConvId,
                                referrer: referrer || '',
                                ...utmParams
                            })
                        }).then(r => r.json());
                    })
                    .then(data => {
                        console.log('[Voice ticket] result:', data);
                        if (data.success) {
                            if (data.ticket_id) {
                                console.log(`[Voice ticket] Тикет #${data.ticket_id} создан`);
                            } else if (data.lead_id) {
                                console.log(`[Voice ticket] Лид ${data.lead_id} создан`);
                            }
                        } else {
                            console.error('[Voice ticket] Ошибка:', data.error);
                        }
                    })
                    .catch(e => console.error('[Voice ticket] Fetch error:', e));
                } else {
                    console.warn('[Voice ticket] Не удалось распарсить имя/телефон из транскрипта');
                }
            } else {
                console.warn('[Voice ticket] confirmMsg не найден в транскрипте');
            }
        }

        // Сбросить накопители
        const hadConversation = transcript.length > 0;
        voiceTranscriptRef.current = [];
        voiceCurrentBotRef.current = '';
        userInputAccumulatorRef.current = '';
        billingCheckedRef.current = false;

        // Переключиться в чат если был разговор
        if (hadConversation) {
            setMode('chat');
            setMessages(prev => [...prev, {
                role: 'bot',
                text: 'Голосовой разговор завершён. Если хотите продолжить или уточнить детали — напишите мне!'
            }]);
            setSuggestions(['Оформить заявку 📝', 'Уточнить тариф 📋', 'Позвонить сейчас 📞']);
        }

        cleanupResources();
        setIsActive(false);
        setStatus('idle');
    };

    // Понятные сообщения об ошибках доступа к микрофону.
    // Возвращает { text, noMic } — noMic=true означает «нет/недоступен микрофон»
    // и включает показ перечёркнутого микрофона на фоне.
    const getMicErrorMessage = (err) => {
        const name = err && err.name;
        switch (name) {
            case 'NotFoundError':
            case 'DevicesNotFoundError':
            case 'OverconstrainedError':
                return { text: 'Микрофон не найден. Подключите микрофон или проверьте, что он включён в системе, и попробуйте снова.', noMic: true };
            case 'NotAllowedError':
            case 'PermissionDeniedError':
            case 'SecurityError':
                return { text: 'Нет доступа к микрофону. Разрешите использование микрофона в настройках браузера и попробуйте снова.', noMic: true };
            case 'NotReadableError':
            case 'TrackStartError':
                return { text: 'Микрофон занят другим приложением. Закройте другие программы, использующие микрофон, и попробуйте снова.', noMic: true };
            default:
                // Нет mediaDevices (старый браузер / не HTTPS-контекст)
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    return { text: 'Голосовой режим недоступен в этом браузере. Откройте сайт в современном браузере по защищённому соединению (https) либо воспользуйтесь чатом.', noMic: true };
                }
                return { text: 'Не удалось включить голосовой режим. Попробуйте ещё раз или воспользуйтесь чатом.', noMic: false };
        }
    };

    const connect = async () => {
        // Ждём загрузки SDK (до 5 секунд)
        let attempts = 0;
        while (!window.GoogleGenAI && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }

        if (!window.GoogleGenAI) {
            setError('SDK не загружен. Обновите страницу.');
            setStatus('error');
            return;
        }

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        const connectionId = Date.now().toString();
        activeConnectionIdRef.current = connectionId;

        setStatus('connecting');
        setIsActive(true);
        setError(null);
        setMicError(false);
        shouldReconnectRef.current = false;

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
            inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            if (activeConnectionIdRef.current !== connectionId) return;

            const ai = new window.GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { baseUrl: 'https://aida.smit34.ru' } });

            const config = {
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                config: {
                    responseModalities: [window.GeminiModality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                    },
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    systemInstruction: `Ты — AIDA, голосовой AI-ассистент интернет-провайдера СМИТ (Smit34.ru) в Волгоградской области.

ТВОЯ ЗАДАЧА: помогать клиентам с выбором тарифа, консультировать по услугам, отвечать на вопросы.

ПЕРВЫЙ ВОПРОС ПРИ ПОДКЛЮЧЕНИИ:
Когда клиент хочет подключить интернет, СНАЧАЛА спроси:
"Вы хотите подключиться как физическое лицо или как компания?"
- Физическое лицо → показывай ТАРИФЫ ДЛЯ ФИЗЛИЦ (ниже)
- Компания / юр. лицо / ИП / ООО → спроси название компании, затем показывай БИЗНЕС-ТАРИФЫ (ниже)

ТАРИФЫ ДЛЯ ФИЗЛИЦ (ИСПОЛЬЗУЙ ТОЛЬКО ЭТИ!):
- «Это просто» — 25 Мбит/с, 869 рублей в месяц
- «Для тебя» — 40 Мбит/с, 749 рублей в месяц
- «Smit» — 100 Мбит/с, 949 рублей в месяц (рекомендуемый)
- «Без границ» — 150 Мбит/с, 1199 рублей в месяц
Подключение: 10 000 рублей (единоразово). Роутер покупается отдельно.

БИЗНЕС-ТАРИФЫ (ТОЛЬКО ДЛЯ КОМПАНИЙ):
- «Старт» — 10 Мбит/с, 2 990 рублей в месяц
- «Офис» — 30 Мбит/с, 4 990 рублей в месяц
- «Бизнес» — 50 Мбит/с, 6 790 рублей в месяц (рекомендуемый)
- «Максимум» — 100 Мбит/с, 9 990 рублей в месяц
Подключение: 10 000 рублей (единоразово).

ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ:
- Видеонаблюдение: от 1 камеры
- Постоянный IP: 150 рублей в месяц

ПРАВИЛА ОБЩЕНИЯ:
- Говори на русском языке
- Будь дружелюбным и профессиональным
- Отвечай кратко и по делу
- ГЛАВНОЕ ПРАВИЛО: ОДИН ВОПРОС ЗА РАЗ — задай вопрос, жди ответ, потом следующий
- НЕЛЬЗЯ спрашивать имя И телефон в одном предложении
- НЕЛЬЗЯ спрашивать тариф И адрес одновременно
- НЕЛЬЗЯ спрашивать когда удобно подключиться — это не нужно
- НЕЛЬЗЯ называть телефон, адрес офиса или график работы
- Сначала узнай имя клиента и его потребности
- Рекомендуй подходящий тариф исходя из потребностей
- После выбора тарифа ОБЯЗАТЕЛЬНО скажи: "Подключение стоит 10 000 рублей единоразово. Роутер приобретается отдельно." — и только потом продолжай
- Если клиент хочет подключиться — узнай по одному: сначала имя, потом телефон, потом адрес
- Если клиент назвал адрес без города или населённого пункта — уточни: "Это в Волгограде?"
- После сбора всех данных (имя, телефон, адрес, тариф) спроси: "Подскажите, как вы о нас узнали?" и дождись ответа
- Получив ответ на "как узнали", СРАЗУ подтверди детали заявки голосом СТРОГО в формате: "Отлично! Итак, Имя: [имя], Телефон: [телефон], Адрес: [адрес], Тариф: «[тариф]». Всё верно?"

ВАЖНО — БИЛЛИНГ:
У тебя НЕТ доступа к системе биллинга. Ты НЕ МОЖЕШЬ самостоятельно проверить баланс, статус или тариф клиента.
НИКОГДА не говори о балансе, задолженности, блокировке или состоянии аккаунта ОТ СЕБЯ.
Единственный способ получить данные биллинга — дождаться системного сообщения, начинающегося с "[ДАННЫЕ БИЛЛИНГА]".
Если ты НЕ получил такое сообщение — у тебя НЕТ данных о клиенте. Точка.

ЕСЛИ КЛИЕНТ ЖАЛУЕТСЯ ("не работает интернет", "нет связи", "проблема", "сломался" и т.п.):
1. Узнай имя (если не назвал)
2. Узнай номер телефона
3. Когда клиент назовёт телефон, скажи ТОЛЬКО: "Спасибо, [имя]. Расскажите, что именно случилось?" — и НИЧЕГО про баланс или аккаунт!
4. Если позже придёт сообщение "[ДАННЫЕ БИЛЛИНГА]" — прочитай его и используй ТОЛЬКО данные из этого сообщения
5. Если придёт сообщение "[ДАННЫЕ БИЛЛИНГА] Клиент НЕ найден" — клиент не в нашей базе, просто продолжай собирать информацию о проблеме
6. Узнай суть проблемы (если ещё не озвучена)
7. Подтверди: "Имя: [имя], Телефон: [телефон], Проблема: [описание]. Создаю обращение в поддержку, всё верно?"

ЗАПРЕЩЕНО:
- Говорить "я вижу задолженность" без полученного [ДАННЫЕ БИЛЛИНГА]
- Говорить "я нашёл ваш аккаунт" без полученного [ДАННЫЕ БИЛЛИНГА]
- Называть любые суммы баланса без полученного [ДАННЫЕ БИЛЛИНГА]
- Говорить "у вас всё в порядке" — клиент жалуется, значит проблема ЕСТЬ`,
                },
            };

            let sessionPromise;

            const handleConnectionDrop = (errorMsg) => {
                if (activeConnectionIdRef.current !== connectionId && activeConnectionIdRef.current !== null) return;
                cleanupResources();
                setStatus('error');
                setError(errorMsg || 'Соединение прервано');
                setIsActive(false);
            };

            const callbacks = {
                onopen: () => {
                    if (activeConnectionIdRef.current !== connectionId) return;
                    reconnectAttemptsRef.current = 0;
                    setStatus('connected');
                    if (!inputContextRef.current || !streamRef.current) return;

                    const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
                    const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
                    processorRef.current = processor;

                    processor.onaudioprocess = (e) => {
                        if (activeConnectionIdRef.current !== connectionId) return;
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcmData = floatTo16BitPCM(inputData);
                        const base64Data = base64Encode(pcmData);
                        sessionPromise.then(session => {
                            if (activeConnectionIdRef.current !== connectionId) return;
                            try {
                                session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64Data } });
                            } catch (err) {}
                        });
                    };

                    source.connect(processor);
                    processor.connect(inputContextRef.current.destination);
                },
                onmessage: async (message) => {
                    if (activeConnectionIdRef.current !== connectionId) return;
                    if (message.serverContent?.interrupted) {
                        sourcesRef.current.forEach(s => { s.stop(); sourcesRef.current.delete(s); });
                        nextStartTimeRef.current = 0;
                        setIsAgentSpeaking(false);
                        return;
                    }

                    // Fix Gemini encoding: UTF-8 bytes misread as Latin-1
                    const fixGeminiEncoding = (text) => {
                        if (!text) return text;
                        if (/[À-ÿ]/.test(text)) {
                            try {
                                const bytes = new Uint8Array(text.length);
                                for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
                                const decoded = new TextDecoder('utf-8').decode(bytes);
                                if (/[а-яА-ЯёЁ]/.test(decoded)) return decoded;
                            } catch {}
                        }
                        return text;
                    };

                    // Clean voice transcript: merge broken fragments, fix spacing
                    const cleanVoiceText = (t) => {
                        if (!t) return t;
                        let s = t;
                        s = s.replace(/\s+/g, ' ');
                        s = s.replace(/\s+([,.:;!?])/g, '$1');
                        for (let i = 0; i < 5; i++) {
                            s = s.replace(/([а-яА-ЯёЁ]) ([а-яёЁ]{1,2}) (?=[а-яА-ЯёЁ])/g, '$1$2');
                            s = s.replace(/([а-яА-ЯёЁ]{1,2}) ([а-яёЁ]{1,3})(?=[\s,.:;!?]|$)/g, (m, a, b) => {
                                if ((a.length + b.length) <= 2) return m;
                                return a + b;
                            });
                        }
                        s = s.replace(/\bгор\s*о?\s*д\b/gi, 'город');
                        s = s.replace(/\bул\s+и\s*ц/gi, 'улиц');
                        s = s.replace(/\bдо\s+м\b/gi, 'дом');
                        s = s.replace(/\bкв\s*а?\s*рт\s*и?\s*р/gi, 'квартир');
                        s = s.replace(/\bко\s*рп\s*ус/gi, 'корпус');
                        s = s.replace(/\bпо\s*д\s*ъ?\s*е\s*зд/gi, 'подъезд');
                        s = s.replace(/\bэ\s*та\s*ж/gi, 'этаж');
                        s = s.replace(/\bте\s*ле\s*фо\s*н/gi, 'телефон');
                        s = s.replace(/\bин\s*те\s*рн\s*е\s*т/gi, 'интернет');
                        s = s.replace(/\bпр\s*о\s*бл\s*е\s*м/gi, 'проблем');
                        s = s.replace(/\bа\s*д\s*ре\s*с/gi, 'адрес');
                        s = s.replace(/\bВо\s*лг\s*о?\s*гр\s*а\s*д/gi, 'Волгоград');
                        s = s.replace(/\bВо\s*лж\s*ск/gi, 'Волжск');
                        s = s.replace(/(\d+)\.\s*$/g, '$1');
                        s = s.replace(/\.\s*$/, '');
                        return s.trim();
                    };

                    // User speech
                    const inputText = fixGeminiEncoding(message.serverContent?.inputTranscription?.text);
                    if (inputText?.trim()) {
                        userInputAccumulatorRef.current += inputText;
                        const accText = cleanVoiceText(userInputAccumulatorRef.current);
                        setMessages(prev => {
                            const last = prev[prev.length - 1];
                            if (last && last.role === 'user' && last.text.startsWith('🎤')) {
                                return [...prev.slice(0, -1), { role: 'user', text: `🎤 ${accText}` }];
                            }
                            return [...prev, { role: 'user', text: `🎤 ${accText}` }];
                        });
                    }

                    // AI output transcription
                    const outputText = fixGeminiEncoding(message.serverContent?.outputTranscription?.text);
                    if (outputText?.trim()) {
                        voiceCurrentBotRef.current += outputText;
                    }

                    // On turn complete
                    if (message.serverContent?.turnComplete) {
                        if (userInputAccumulatorRef.current) {
                            const userText = cleanVoiceText(userInputAccumulatorRef.current);
                            voiceTranscriptRef.current.push({ role: 'user', text: userText });

                            // Проверка телефона в биллинге (один раз за сессию)
                            if (!billingCheckedRef.current) {
                                const phoneMatch = userText.replace(/\s+/g, '').match(/(\+?[78][\d\-\(\)]{9,14})/);
                                if (phoneMatch) {
                                    billingCheckedRef.current = true;
                                    const phoneDigits = phoneMatch[1].replace(/\D/g, '');
                                    console.log('[Voice] Phone detected, checking billing:', phoneDigits);
                                    fetch(`https://aida.smit34.ru/api/voice-billing-check?phone=${phoneDigits}`)
                                        .then(r => r.json())
                                        .then(billing => {
                                            if (billing.found && sessionRef.current) {
                                                const statusRu = billing.status === 'active' ? 'Активен' : 'Заблокирован';
                                                const balStr = billing.balance < 0 ? `${billing.balance} руб. (ЗАДОЛЖЕННОСТЬ)` : `${billing.balance} руб.`;
                                                const ctx = `[ДАННЫЕ БИЛЛИНГА] Клиент найден: ${billing.name}, Договор: ${billing.contract}, Баланс: ${balStr}, Статус: ${statusRu}, Тариф: ${billing.tariff}, Адрес: ${billing.address}. Используй эти данные для диагностики проблемы клиента.`;
                                                console.log('[Voice] Billing injected:', ctx);
                                                try {
                                                    sessionRef.current.sendClientContent({
                                                        turns: [{ role: 'user', parts: [{ text: ctx }] }],
                                                        turnComplete: true
                                                    });
                                                } catch(e) { console.warn('[Voice] Billing inject error:', e); }
                                            } else if (sessionRef.current) {
                                                console.log('[Voice] Client not found in billing, injecting NOT FOUND');
                                                try {
                                                    sessionRef.current.sendClientContent({
                                                        turns: [{ role: 'user', parts: [{ text: '[ДАННЫЕ БИЛЛИНГА] Клиент НЕ найден в системе по этому номеру. НЕ придумывай данные! Просто продолжай собирать информацию о проблеме и создай обращение.' }] }],
                                                        turnComplete: true
                                                    });
                                                } catch(e) { console.warn('[Voice] Billing not-found inject error:', e); }
                                            }
                                        })
                                        .catch(e => console.warn('[Voice] Billing check failed:', e));
                                }
                            }

                            userInputAccumulatorRef.current = '';
                        }
                        if (voiceCurrentBotRef.current.trim()) {
                            const botText = voiceCurrentBotRef.current.trim();
                            voiceTranscriptRef.current.push({ role: 'bot', text: botText });
                            setMessages(prev => [...prev, { role: 'bot', text: `🔊 ${botText}` }]);
                            voiceCurrentBotRef.current = '';
                        }
                    }

                    // Play audio
                    const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
                    if (base64Audio && audioContextRef.current) {
                        setIsAgentSpeaking(true);
                        const audioCtx = audioContextRef.current;
                        const pcmData = base64Decode(base64Audio);
                        const audioBuffer = await decodeAudioData(pcmData, audioCtx, 24000, 1);
                        const startTime = Math.max(nextStartTimeRef.current, audioCtx.currentTime + 0.02);
                        nextStartTimeRef.current = startTime + audioBuffer.duration;
                        const source = audioCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioCtx.destination);
                        source.onended = () => {
                            sourcesRef.current.delete(source);
                            if (sourcesRef.current.size === 0) setIsAgentSpeaking(false);
                        };
                        source.start(startTime);
                        sourcesRef.current.add(source);
                    }
                },
                onclose: (e) => {
                    console.warn('[Gemini] onclose', e);
                    handleConnectionDrop('Сессия завершена');
                },
                onerror: (e) => {
                    console.error('[Gemini] onerror', e);
                    const msg = e?.message || e?.code || JSON.stringify(e) || 'unknown';
                    handleConnectionDrop('Ошибка: ' + msg.slice(0, 80));
                }
            };

            sessionPromise = ai.live.connect({ ...config, callbacks });
            sessionPromise.then(session => {
                if (activeConnectionIdRef.current === connectionId) {
                    sessionRef.current = session;
                    try {
                        session.sendClientContent({
                            turns: [{ role: 'user', parts: [{ text: '[НАЧАЛО СЕССИИ] Поздоровайся с клиентом и спроси чем можешь помочь.' }] }],
                            turnComplete: true
                        });
                    } catch(e) {}
                }
            }).catch(e => {
                const msg = e?.message || e?.statusText || String(e);
                console.error('[Gemini] connect error:', msg, e);
                handleConnectionDrop('Не удалось подключиться: ' + msg.slice(0, 80));
            });

        } catch (err) {
            console.error('Failed to connect:', err);
            cleanupResources();
            setIsActive(false);
            setStatus('error');
            const info = getMicErrorMessage(err);
            setError(info.text);
            setMicError(info.noMic);
        }
    };

    useEffect(() => {
        return () => { shouldReconnectRef.current = false; cleanupResources(); };
    }, []);

    // Pending message ref — used when widget is opened with a preset message
    const pendingMessageRef = useRef(null);
    const pendingModeRef = useRef(null);
    const autoConnectRef = useRef(false);

    // Expose open function globally (accepts optional message and options)
    useEffect(() => {
        window.openAIWidget = (message, options) => {
            setIsOpen(true);
            if (options && options.voice) {
                pendingModeRef.current = 'voice';
                if (options.autoConnect) autoConnectRef.current = true;
            } else {
                setMode('chat');
            }
            if (message) pendingMessageRef.current = message;
        };
        return () => { delete window.openAIWidget; };
    }, []);

    // Apply pending mode after widget opens
    useEffect(() => {
        if (isOpen && pendingModeRef.current) {
            setMode(pendingModeRef.current);
            pendingModeRef.current = null;
        }
    }, [isOpen]);

    // Auto-connect voice when opened programmatically
    useEffect(() => {
        if (isOpen && mode === 'voice' && autoConnectRef.current && !isActive) {
            autoConnectRef.current = false;
            setTimeout(() => connect(), 400);
        }
    }, [isOpen, mode]);

    // Send pending message once widget is open and not loading
    useEffect(() => {
        if (isOpen && pendingMessageRef.current && !isLoading) {
            const msg = pendingMessageRef.current;
            pendingMessageRef.current = null;
            sendMessage(msg);
        }
    }, [isOpen]);

    // Block body scroll when widget is open on mobile
    useEffect(() => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile && isOpen) {
            document.body.style.overflow = "hidden";
            document.body.style.position = "fixed";
            document.body.style.width = "100%";
            document.body.style.top = `-${window.scrollY}px`;
        }
        return () => {
            if (document.body.style.position === "fixed") {
                const scrollY = Math.abs(parseInt(document.body.style.top || "0"));
                document.body.style.overflow = "";
                document.body.style.position = "";
                document.body.style.width = "";
                document.body.style.top = "";
                window.scrollTo(0, scrollY);
            }
        };
    }, [isOpen]);

    // Auto-scroll to latest message
    useEffect(() => {
        if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    // Parse suggestion buttons from backend response
    const parseResponse = (text) => {
        const buttons = [];
        const cleanText = text.replace(/💡[^\n]*/g, (match) => {
            const found = [...match.matchAll(/[\u00ab"\u201c]([^\u00bb"\u201d]+)[\u00bb"\u201d]/g)].map(m => m[1]);
            buttons.push(...found);
            return '';
        }).trim();
        return { cleanText, buttons };
    };

    // Send chat message to backend
    const sendMessage = async (text) => {
        let message = text;
        if (phoneMode && !text.includes(' ') && text.startsWith('+7')) {
            const raw = text.replace(/\D/g, '');
            let digits = raw;
            if (digits.startsWith('7')) digits = digits.substring(1);
            else if (digits.startsWith('8')) digits = digits.substring(1);
            if (digits.length < 10) return;
            message = '+7' + digits;
            setMessages(prev => [...prev, { role: 'user', text: formatPhone(digits) }]);
            setPhoneMode(false);
            setInput('');
        } else {
            if (!text.trim() || isLoading) return;
            setMessages(prev => [...prev, { role: 'user', text }]);
            setInput('');
        }
        setIsLoading(true);
        setSuggestions([]);
        setPhoneMode(false);
        try {
            const chatBody = { session_id: sessionId, message };
            if (!deviceInfoSent.current) {
                Object.assign(chatBody, getDeviceInfo());
                deviceInfoSent.current = true;
            }
            const res = await fetch('https://aida.smit34.ru/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(chatBody)
            });
            const data = await res.json();
            const { cleanText, buttons } = parseResponse(data.response);
            setMessages(prev => [...prev, { role: 'bot', text: cleanText }]);
            setSuggestions(buttons.length > 0 ? buttons : []);
            if (isMobile()) {
                const lo = cleanText.toLowerCase();
                const askAddr = [/укажите.*адрес/, /ваш адрес подключения/, /какой.*адрес/, /адрес.*подключения/];
                const skipAddr = ["квартира или", "это квартира", "номер квартиры", "адрес:", "по адресу"];
                const isAsk = askAddr.some(r => r.test(lo)) && !skipAddr.some(s => lo.includes(s));
                setShowGeoBtn(isAsk);
            } else { setShowGeoBtn(false); }
            if (checkPhoneQuestion(cleanText)) {
                setPhoneMode(true);
                setInput('+7(');
                setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 300);
            }
        } catch {
            setMessages(prev => [...prev, { role: 'bot', text: 'Ошибка соединения. Попробуйте ещё раз.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    // Microphone dictation for chat input
    const startDictation = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        const rec = new SR();
        rec.lang = 'ru-RU';
        rec.onresult = e => setInput(e.results[0][0].transcript);
        rec.start();
    };

    // Icons from global scope
    const { Bot, X, Phone, Mic, MicOff, Square, Loader2, ArrowRight } = window._SmitIcons || {};

    return (
        <div className="ai-widget-outer fixed bottom-6 right-6 z-[50] flex flex-col items-end pointer-events-none">
            {/* Widget Panel */}
            <div className={`pointer-events-auto mb-4 backdrop-blur-xl bg-white/80 dark:bg-slate-900/85 border border-white/30 dark:border-slate-700/50 shadow-[0_20px_60px_rgba(16,185,129,0.25)] overflow-hidden transition-all duration-500 flex flex-col w-80 sm:w-96 rounded-3xl origin-bottom-right
                ${isOpen ? 'opacity-100 scale-100 translate-y-0 ai-widget-open' : 'opacity-0 scale-90 translate-y-10 pointer-events-none'}`}
                style={{ height: isOpen ? '580px' : '0' }}
                id="ai-widget-panel">

                {/* Header */}
                <div className="bg-emerald-600/90 dark:bg-emerald-800/90 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                            <Bot size={18} />
                        </div>
                        <div>
                            <p className="font-bold text-sm">AIDA</p>
                            <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-pulse"></div>
                                <p className="text-xs text-emerald-100">онлайн</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setMode('voice')} title="Голосовой режим" className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${mode === 'voice' ? 'bg-white/30' : 'bg-white/10 hover:bg-white/20'}`}>
                            <Phone size={14} />
                        </button>
                        <button onClick={() => { if (mode === 'voice') stop(); setIsOpen(false); }} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Mode Tabs */}
                <div className="flex border-b border-slate-200/50 dark:border-slate-700/50 flex-shrink-0 bg-white/50 dark:bg-slate-900/50">
                    <button onClick={() => setMode('chat')} className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'chat' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
                        <Bot size={13} /> Чат
                    </button>
                    <button onClick={() => setMode('voice')} className={`flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'voice' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
                        <Mic size={13} /> Голос
                    </button>
                </div>

                {/* Chat Mode */}
                {mode === 'chat' && (
                    <>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                            {messages.map((msg, i) => (
                                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-white/70 dark:bg-slate-800/70 border border-white/50 dark:border-slate-700/50 text-slate-800 dark:text-slate-200 rounded-bl-sm'}`}>
                                        {renderMd(msg.text)}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-white/70 dark:bg-slate-800/70 border border-white/50 dark:border-slate-700/50 px-4 py-3 rounded-2xl rounded-bl-sm">
                                        <div className="flex gap-1.5 items-center">
                                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay:'0ms'}}></div>
                                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay:'150ms'}}></div>
                                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay:'300ms'}}></div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {suggestions.length > 0 && (
                            <div className="px-3 py-2 flex gap-2 overflow-x-auto flex-shrink-0 border-t border-slate-200/30 dark:border-slate-700/30" style={{scrollbarWidth:'none'}}>
                                {suggestions.map((s, i) => (
                                    <button key={i} onClick={() => sendMessage(s)}
                                        className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full bg-white/60 dark:bg-slate-700/60 border border-emerald-200/50 dark:border-emerald-700/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-700 dark:text-slate-300 transition-colors flex-shrink-0">
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}

                            {showGeoBtn && (
                            <div className="px-3 py-2 flex gap-2 border-t border-slate-200/30 dark:border-slate-700/30">
                                <button onClick={handleGeolocate} disabled={geoLoading}
                                    className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-800/40 text-emerald-700 dark:text-emerald-300 transition-colors flex-shrink-0">
                                    {geoLoading ? "⏳ Определяю..." : "📍 Определить адрес"}
                                </button>
                            </div>
                        )}
                        <div className="px-3 py-3 border-t border-slate-200/50 dark:border-slate-700/50 flex gap-2 items-center flex-shrink-0 bg-white/50 dark:bg-slate-900/50">
                            <input ref={inputRef} value={input}
                                onChange={phoneMode ? handlePhoneInput : (e => setInput(e.target.value))}
                                onKeyDown={phoneMode ? (e => { handlePhoneKeyDown(e); if (e.key === 'Enter') sendMessage(input); }) : (e => e.key === 'Enter' && sendMessage(input))}
                                type={phoneMode ? 'tel' : 'text'}
                                placeholder={phoneMode ? '+7(___) ___-__-__' : 'Задайте вопрос...'}
                                className={`flex-1 bg-white/80 dark:bg-slate-800/80 border border-slate-200/50 dark:border-slate-700/50 rounded-xl px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all ${phoneMode ? 'font-mono text-base tracking-wide' : ''}`} />
                            <button onClick={() => sendMessage(input)} disabled={!input.trim() || isLoading}
                                className="w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors flex-shrink-0">
                                <ArrowRight size={15} />
                            </button>
                        </div>
                    </>
                )}

                {/* Voice Mode */}
                {mode === 'voice' && (
                    <div className="flex-1 flex flex-col min-h-0">
                        {/* Live transcript — same messages as chat */}
                        {status === 'connected' || messages.some(m => m.text?.startsWith('🎤') || m.text?.startsWith('🔊')) ? (
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                                {messages.filter(m => m.text?.startsWith('🎤') || m.text?.startsWith('🔊')).map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-white/70 dark:bg-slate-800/70 border border-white/50 dark:border-slate-700/50 text-slate-800 dark:text-slate-200 rounded-bl-sm'}`}>
                                            {renderMd(msg.text)}
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                {status === 'idle' && <span className="text-slate-400 text-sm text-center px-6">Нажмите «Начать» — разговор появится здесь</span>}
                                {status === 'error' && (
                                    <div className="relative flex flex-col items-center justify-center gap-3 px-6 text-center w-full">
                                        {micError && MicOff && (
                                            <MicOff
                                                size={120}
                                                strokeWidth={1.5}
                                                className="absolute -top-2 text-slate-400/15 dark:text-slate-500/15 pointer-events-none"
                                            />
                                        )}
                                        <div className="relative z-10 flex flex-col items-center gap-2">
                                            {micError && MicOff && (
                                                <MicOff size={36} strokeWidth={1.5} className="text-slate-400 dark:text-slate-500" />
                                            )}
                                            <span className="text-xs font-bold uppercase tracking-widest text-red-500">
                                                {micError ? 'Микрофон недоступен' : 'Ошибка'}
                                            </span>
                                            <span className="text-sm text-slate-600 dark:text-slate-300 leading-snug max-w-[280px]">{error}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Waveform + controls */}
                        <div className="flex-shrink-0 p-4 border-t border-slate-200/30 dark:border-slate-700/30 flex flex-col gap-3">
                            {status === 'connecting' && (
                                <div className="flex items-center justify-center gap-2 text-emerald-500 py-1">
                                    <Loader2 size={18} />
                                    <span className="text-xs font-bold uppercase tracking-widest">Подключение...</span>
                                </div>
                            )}
                            {status === 'connected' && (
                                <div className="flex items-end justify-center gap-1 h-8">
                                    {[0,1,2,3,4,5,6,7].map(i => (
                                        <div key={i} className="w-2 bg-emerald-500 rounded-full transition-all duration-300"
                                            style={{ height: isAgentSpeaking ? `${30 + ((i*37+13)%60)}%` : '25%',
                                                     opacity: isAgentSpeaking ? 1 : 0.4 }}></div>
                                    ))}
                                </div>
                            )}
                            {!isActive ? (
                                <button onClick={connect} className="w-full py-3 bg-emerald-500 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-600 active:scale-95 transition-all flex items-center justify-center gap-2">
                                    <Mic size={18} /> Начать разговор
                                </button>
                            ) : (
                                <button onClick={stop} className="w-full py-3 bg-red-500 text-white font-bold rounded-xl shadow-lg hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center gap-2">
                                    <Square size={18} /> Завершить
                                </button>
                            )}
                            <a href="https://storage.googleapis.com/uspeshnyy-projects/smit/smit34.ru/soglasie-PD.pdf" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 underline underline-offset-2 text-center transition-colors">Согласен на обработку перс.данных</a>
                        </div>
                    </div>
                )}
            </div>

            {/* Toggle Button */}
            <button onClick={() => setIsOpen(!isOpen)}
                className={`ai-widget-toggle pointer-events-auto w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 relative group ${isOpen ? 'ai-widget-toggle-open bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-gradient-to-r from-emerald-500 to-teal-400 text-white'}`}>
                {isOpen ? <X size={24} /> : <Bot size={24} />}
                {!isOpen && (
                    <span className="absolute right-full mr-4 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                        AI Ассистент
                    </span>
                )}
            </button>
        </div>
    );
}

// Экспортируем в глобальный scope
window.AIWidget = AIWidget;
