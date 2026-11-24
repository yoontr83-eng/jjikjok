export const maxDuration = 60;

// ==============================================
// 설정 가능한 상수 (필요에 따라 값을 조정하세요)
// ==============================================

// 허용할 업로드 MIME 타입 목록 (이미지 + PDF 네이티브 지원)
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

// 입력값 크기 제한
const MAX_UPLOAD_COUNT = 3;
const MAX_TEXT_LENGTH = 15000;
const MAX_BASE64_LENGTH = 4.5 * 1024 * 1024; // 파일 1개당 약 3.3MB 원본 상당

// 타임아웃 예산 (Vercel 60초 / 프론트엔드 55초 제한보다 여유 있게 설정)
const TOTAL_TIMEOUT_BUDGET_MS = 48000;
const PER_MODEL_TIMEOUT_MS = 20000;
const MIN_REMAINING_TIME_MS = 4000;

// 일시적 서버/혼잡 오류에만 다음 모델로 우회 (400, 401, 403 등은 즉시 중단)
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

// 구글 서버 혼잡(503/429) 자동 우회용 3개 차선 (종료 예정 모델 제외)
const MODEL_CANDIDATES = [
  { name: "gemini-4-hydrogen", useThinking: true },
  { name: "gemini-3.8-flash", useThinking: true },
  { name: "gemini-3.5-flash-lite", useThinking: false }
];

// 과목별 프롬프트 가이드
const SUBJECT_GUIDES = {
  "국어":
    "국어(문법·문학·독서) 개념이 '왜 그렇게 적용되는지' 그 원리를 설명하고 구체적 단어나 문장 예시를 단계별로 분석하세요. 중세 국어 옛한글은 반드시 표준 유니코드 옛한글 첫가끝 조합형으로 표기하세요.",
  "영어":
    "지문의 논리적 인과 흐름이나 내신 어법(수일치·분사구문·관계사 what vs that)의 문장 구조 원리를 명쾌하게 설명하고 실제 문장 예시로 판별 과정을 보여주세요.",
  "통합과학":
    "물리·화학·생명·지구과학 현상이 '왜 일어나는지' 과학적 인과관계를 설명하고, 상태 조건·그래프 해석·예외 사례를 구체적 예시로 적용해 보여주세요.",
  "통합사회":
    "유사 개념(자유권 vs 사회권, 기회비용 vs 매몰비용 등)의 등장 배경과 판단 기준을 설명하고, 실제 사례나 계산 과정을 단계별로 풀이해 보여주세요."
};

// 구조화 JSON 출력 스키마
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    subjectTitle: { type: "STRING" },
    teacherPicks: { type: "ARRAY", items: { type: "STRING" } },
    summaryCards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          coreSummary: { type: "STRING" },
          whyExplanation: { type: "STRING" },
          stepByStepExample: { type: "STRING" },
          isStarred: { type: "BOOLEAN" }
        },
        required: ["title", "coreSummary", "whyExplanation", "stepByStepExample", "isStarred"]
      }
    },
    blankItems: { type: "ARRAY", items: { type: "STRING" } },
    oxQuiz: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          answer: { type: "STRING" },
          trapExplanation: { type: "STRING" }
        },
        required: ["question", "answer", "trapExplanation"]
      }
    },
    audioScript: { type: "STRING" }
  },
  required: ["subjectTitle", "teacherPicks", "summaryCards", "blankItems", "oxQuiz", "audioScript"]
};

/**
 * 요청의 Origin이 허용된 도메인인지 확인합니다.
 * - Vercel 환경변수 ALLOWED_ORIGINS(쉼표 구분)에 등록된 도메인 허용
 * - 현재 서버의 호스트(동일 도메인) 및 로컬 개발 환경(localhost) 자동 허용
 */
function resolveAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;

  const envOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (envOrigins.includes(origin)) {
    return origin;
  }

  // 동일 도메인(배포된 Vercel 도메인 자체) 및 로컬 테스트 허용
  const host = req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) {
    return origin;
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin;
  }

  return null;
}

/**
 * HTTP 상태 코드에 따른 사용자 친화적 안내 문구를 반환합니다.
 */
function getFriendlyErrorMessage(status) {
  if (status === 400) return "입력된 사진·PDF 또는 텍스트 형식을 처리할 수 없습니다. 다른 파일로 시도해 주세요.";
  if (status === 401 || status === 403) return "AI 서버 인증에 실패했습니다. 관리자에게 문의해 주세요.";
  if (status === 413) return "업로드된 파일 용량이 너무 큽니다. 3MB 이하의 PDF나 사진으로 시도해 주세요.";
  if (status === 429) return "현재 요청이 많아 AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.";
  if (status === 504) return "AI 분석 시간이 초과되었습니다. 파일 개수를 줄이거나 잠시 후 다시 시도해 주세요.";
  return "일시적인 AI 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

export default async function handler(req, res) {
  // 1. CORS 헤더 설정 (허용된 도메인만 접근 가능)
  const requestOrigin = req.headers.origin;
  const allowedOrigin = resolveAllowedOrigin(req);

  if (requestOrigin && !allowedOrigin) {
    return res.status(403).json({ error: "허용되지 않은 도메인에서의 요청입니다." });
  }

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 2. API 키 확인
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    console.error("[/api/generate] GEMINI_API_KEY 환경변수가 비어 있습니다.");
    return res.status(500).json({ error: "서버에 AI API 키가 설정되지 않았습니다." });
  }

  try {
    const { images, text, subject } = req.body || {};
    const subjectName = SUBJECT_GUIDES[subject] ? subject : "국어";

    // 3. 입력값 사전 필터링 및 크기 제한 (이미지 + PDF 지원)
    const safeText = typeof text === "string" ? text.trim().slice(0, MAX_TEXT_LENGTH) : "";

    const validFiles = (Array.isArray(images) ? images : [])
      .filter((item) => {
        if (!item || typeof item.base64 !== "string" || typeof item.mimeType !== "string") {
          return false;
        }
        const normalizedMime = item.mimeType.toLowerCase().trim();
        return (
          ALLOWED_MIME_TYPES.has(normalizedMime) &&
          item.base64.length > 0 &&
          item.base64.length <= MAX_BASE64_LENGTH
        );
      })
      .slice(0, MAX_UPLOAD_COUNT);

    if (validFiles.length === 0 && !safeText) {
      return res.status(400).json({
        error: "유효한 사진(JPG/PNG/WEBP), PDF 파일(최대 3개, 3MB 이하), 또는 텍스트를 입력해 주세요."
      });
    }

    // 4. 시스템 프롬프트 및 멀티모달 파트 구성 (환각 방지 규칙 포함)
    const systemPrompt = `당신은 대한민국 고등학교 내신 [${subjectName}] 베테랑 1타 강사입니다.
업로드된 학교 프린트 이미지·PDF 문서(또는 텍스트)를 통합 분석하여 벼락치기 자료 4종 세트를 핵심만 간결하게 담아 JSON으로 출력하세요.

[과목 지침 - ${subjectName}]
${SUBJECT_GUIDES[subjectName] || ""}

[작성 규칙]
1. 억지 비유 없이 '왜 그런지(작동 원리)'와 '어떻게 판별하는지'를 2~3문장으로 명쾌하게 설명하세요.
2. 별표(★), 밑줄, 형광펜, '중요/주의' 표시가 있다면 최우선 출제 포인트(teacherPicks) 2~3개로 뽑으세요.
3. summaryCards는 핵심 개념 3개로 구성하며 각 카드에 coreSummary(핵심 요약), whyExplanation(원리 풀이), stepByStepExample(예시 단계별 해부), isStarred를 포함하세요.
4. blankItems는 핵심 암기 문장 3~4개를 작성하되, 빈칸 키워드만 {{정답}} 형식으로 감싸세요.
5. oxQuiz는 내신 말장난 함정 선지를 섞어 4~5문제를 출제하고 1줄 해설을 다세요.
6. audioScript는 등굣길에 듣는 200~260자 구어체 브리핑 대본으로 괄호나 특수기호 없이 작성하세요.
7. 반드시 업로드된 자료(이미지·PDF)와 텍스트에 근거한 내용만 작성하세요. 글씨가 흐릿하거나 잘려서 판독이 어려운 부분은 절대 추측해서 지어내지 말고, 판독 가능한 핵심 내용 위주로만 정리하세요.`;

    const parts = [];
    validFiles.forEach((fileItem, idx) => {
      const mime = fileItem.mimeType.toLowerCase().trim();
      const labelText =
        mime === "application/pdf"
          ? `[${subjectName} PDF 학습 자료 ${idx + 1}]`
          : `[${subjectName} 프린트 ${idx + 1}쪽]`;
      parts.push({ text: labelText });
      parts.push({
        inlineData: {
          mimeType: mime,
          data: fileItem.base64
        }
      });
    });

    parts.push({
      text: safeText
        ? `위 [${subjectName}] 자료(${validFiles.length}개)와 아래 필기를 통합 분석해 벼락치기 4종 세트 JSON을 만들어줘:\n${safeText}`
        : `첨부된 [${subjectName}] 자료(${validFiles.length}개) 속 본문과 필기를 읽고 핵심 원리 풀이 4종 세트 JSON을 만들어줘.`
    });

    // 5. 전체 시간 예산 내에서 다중 모델 순차 시도
    const requestStartTime = Date.now();
    let lastStatus = 500;
    let lastErrorLog = "";

    for (const candidate of MODEL_CANDIDATES) {
      const elapsed = Date.now() - requestStartTime;
      const remainingBudget = TOTAL_TIMEOUT_BUDGET_MS - elapsed;

      if (remainingBudget < MIN_REMAINING_TIME_MS) {
        console.warn(`[/api/generate] 전체 시간 예산(${TOTAL_TIMEOUT_BUDGET_MS}ms) 소진으로 루프를 종료합니다.`);
        lastStatus = 504;
        break;
      }

      const attemptTimeoutMs = Math.min(PER_MODEL_TIMEOUT_MS, remainingBudget);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);

      const generationConfig = {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      };

      if (candidate.useThinking) {
        generationConfig.thinkingConfig = { thinkingLevel: "low" };
      }

      let response;
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${candidate.name}:generateContent`;
        response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [{ parts }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig
          }),
          signal: controller.signal
        });
      } catch (fetchErr) {
        clearTimeout(timer);
        if (fetchErr?.name === "AbortError") {
          lastStatus = 504;
          lastErrorLog = `[${candidate.name}] 요청 시간 초과 (${attemptTimeoutMs}ms)`;
        } else {
          lastStatus = 502;
          lastErrorLog = `[${candidate.name}] 네트워크 연결 오류: ${fetchErr?.message || "unknown"}`;
        }
        console.warn(`[/api/generate] ${lastErrorLog}`);
        continue;
      } finally {
        clearTimeout(timer);
      }

      // HTTP 오류 응답 처리
      if (!response.ok) {
        lastStatus = response.status;
        const errBody = await response.text().catch(() => "");
        lastErrorLog = `[${candidate.name}] HTTP ${response.status} - ${errBody.slice(0, 300)}`;
        console.error(`[/api/generate] ${lastErrorLog}`);

        // 400, 401, 403 등 재시도가 무의미한 오류는 즉시 반환
        if (!RETRYABLE_HTTP_STATUSES.has(response.status)) {
          break;
        }
        continue;
      }

      // 정상 HTTP 응답 파싱 (네트워크 에러와 명확히 분리)
      try {
        const data = await response.json();
        const firstCandidate = data?.candidates?.[0];
        const finishReason = firstCandidate?.finishReason;

        if (finishReason && finishReason !== "STOP") {
          console.warn(`[/api/generate] [${candidate.name}] 비정상 종료 finishReason=${finishReason}`);
        }

        // Thinking 모델의 사고 파트(thought: true)를 건너뛰고 실제 텍스트 파트 탐색
        const candidateParts = firstCandidate?.content?.parts || [];
        const rawText = candidateParts.find((p) => !p.thought && typeof p.text === "string")?.text;

        if (!rawText) {
          lastStatus = 502;
          lastErrorLog = `[${candidate.name}] 비어 있는 응답 (finishReason=${finishReason || "unknown"})`;
          console.warn(`[/api/generate] ${lastErrorLog}`);
          continue;
        }

        const cleanedJson = rawText
          .replace(/^```json\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();

        const parsed = JSON.parse(cleanedJson);
        return res.status(200).json(parsed);
      } catch (parseErr) {
        lastStatus = 502;
        lastErrorLog = `[${candidate.name}] JSON 파싱 실패: ${parseErr?.message || "invalid json"}`;
        console.error(`[/api/generate] ${lastErrorLog}`);
        continue;
      }
    }

    // 모든 후보 실패 시 클라이언트에는 정제된 메시지만 반환 (상세 로그는 서버에만 기록)
    const isDev = process.env.NODE_ENV !== "production";
    return res.status(lastStatus).json({
      error: getFriendlyErrorMessage(lastStatus),
      ...(isDev && lastErrorLog ? { detail: lastErrorLog.slice(0, 300) } : {})
    });
  } catch (error) {
    console.error("[/api/generate] 처리 중 예기치 않은 서버 오류:", error);
    return res.status(500).json({
      error: "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
}
