export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." });
  }

  try {
    const { images, text, subject } = req.body || {};
    const subjectName = subject || "국어";
    const imageList = Array.isArray(images) ? images.slice(0, 3) : [];

    if (imageList.length === 0 && !text) {
      return res.status(400).json({ error: "프린트 사진(1~3장)이나 텍스트를 입력해 주세요." });
    }

    const subjectGuides = {
      "국어": "국어(문법·문학·독서) 규칙이 '왜 그렇게 적용되는지' 문법적 원리를 설명하고 구체적 단어나 문장 예시를 단계별로 분석하세요. 중세 국어 옛한글은 반드시 표준 유니코드 옛한글 첫가끝 조합형으로 표기하세요.",
      "영어": "지문의 논리적 인과 흐름이나 내신 어법(수일치·분사구문·관계사 what vs that)의 문장 구조 원리를 명쾌하게 설명하고 실제 문장 예시로 판별 과정을 보여주세요.",
      "통합과학": "물리·화학·생명·지구과학 현상이 '왜 일어나는지' 과학적 인과관계를 설명하고, 상태 조건·그래프 해석·예외 사례를 구체적 예시로 적용해 보여주세요.",
      "통합사회": "유사 개념(자유권 vs 사회권, 기회비용 vs 매몰비용 등)의 등장 배경과 판단 기준을 설명하고, 실제 사례나 계산 과정을 단계별로 풀이해 보여주세요."
    };

    const systemPrompt = `당신은 대한민국 고등학교 내신 [${subjectName}] 베테랑 1타 강사입니다.
업로드된 학교 프린트 이미지(또는 텍스트)를 통합 분석하여 벼락치기 자료 4종 세트를 핵심만 간결하게 담아 JSON으로 출력하세요.

[과목 지침 - ${subjectName}]
${subjectGuides[subjectName] || ""}

[작성 규칙]
1. 억지 비유 없이 '왜 그런지(작동 원리)'와 '어떻게 판별하는지'를 2~3문장으로 명쾌하게 설명하세요.
2. 별표(★), 밑줄, 형광펜, '중요/주의' 표시가 있다면 최우선 출제 포인트(teacherPicks) 2~3개로 뽑으세요.
3. summaryCards는 핵심 개념 3개로 구성하며 각 카드에 coreSummary(핵심 요약), whyExplanation(원리 풀이), stepByStepExample(예시 단계별 해부), isStarred를 포함하세요.
4. blankItems는 핵심 암기 문장 3~4개를 작성하되, 빈칸 키워드만 {{정답}} 형식으로 감싸세요.
5. oxQuiz는 내신 말장난 함정 선지를 섞어 4~5문제를 출제하고 1줄 해설을 다세요.
6. audioScript는 등굣길에 듣는 200~260자 구어체 브리핑 대본으로 괄호나 특수기호 없이 작성하세요.`;

    const parts = [];
    imageList.forEach((img, idx) => {
      if (img && img.base64 && img.mimeType) {
        parts.push({ text: `[${subjectName} 프린트 ${idx + 1}쪽]` });
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64
          }
        });
      }
    });

    parts.push({
      text: text
        ? `위 [${subjectName}] 프린트(${imageList.length}장)와 아래 필기를 통합 분석해 벼락치기 4종 세트 JSON을 만들어줘:\n${text}`
        : `첨부된 [${subjectName}] 프린트 사진(${imageList.length}장) 속 글씨와 필기를 읽고 핵심 원리 풀이 4종 세트 JSON을 만들어줘.`
    });

    const responseSchema = {
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

    // 구글 서버 혼잡(503) 자동 우회용 5개 차선 (한산하고 빠른 모델 우선 배치)
    const modelCandidates = [
      { name: "gemini-3.6-flash", useThinking: false },
      { name: "gemini-3.1-flash-lite", useThinking: false },
      { name: "gemini-3.5-flash-lite", useThinking: false },
      { name: "gemini-3.8-flash", useThinking: true },
      { name: "gemini-4-hydrogen", useThinking: true }
    ];

    let lastStatus = 500;
    let lastErrorDetail = "";

    for (const candidate of modelCandidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);

      const generationConfig = {
        maxOutputTokens: 3500,
        responseMimeType: "application/json",
        responseSchema
      };

      if (candidate.useThinking) {
        generationConfig.thinkingConfig = { thinkingLevel: "low" };
      }

      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${candidate.name}:generateContent`;
        const response = await fetch(apiUrl, {
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

        clearTimeout(timer);

        if (response.ok) {
          const data = await response.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const cleanedJson = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
            return res.status(200).json(JSON.parse(cleanedJson));
          }
        } else {
          lastStatus = response.status;
          lastErrorDetail = `[${candidate.name}] ${await response.text()}`;
        }
      } catch (fetchErr) {
        clearTimeout(timer);
        lastStatus = 504;
        lastErrorDetail = `[${candidate.name}] 응답 지연 (${fetchErr.message})`;
      }
    }

    return res.status(lastStatus).json({
      error: `Google AI 응답 오류 (${lastStatus})`,
      detail: lastErrorDetail.slice(0, 300)
    });
  } catch (error) {
    return res.status(500).json({ error: `서버 내부 오류: ${error.message}` });
  }
}
