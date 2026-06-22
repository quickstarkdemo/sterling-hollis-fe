import { Badge, Box, Button, Container, HStack, Input, NativeSelect, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { FiCamera, FiCheckCircle, FiCpu, FiImage, FiLoader, FiUploadCloud } from "react-icons/fi";
import { useEffect, useMemo, useRef, useState } from "react";

import AiPanel from "../components/AiPanel";
import { usePageChatContext } from "../components/ChatContext";
import ProductCard from "../components/ProductCard";
import { getImageRecommendations } from "../utils/apiClient";
import { trackAction } from "../utils/datadog";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const categoryOptions = [
  ["", "Any category"],
  ["womens_apparel", "Women"],
  ["mens_apparel", "Men"],
  ["shoes", "Shoes"],
  ["handbags", "Handbags"],
  ["beauty", "Beauty"],
  ["jewelry_accessories", "Jewelry & Accessories"],
];

function imageRecommendationErrorMessage(error) {
  if (error?.response?.status === 413) {
    return "Image is too large. Use a JPG, PNG, or WebP under 8 MB.";
  }
  return "Image recommendations are unavailable right now.";
}

export default function StyleFinderPage() {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [category, setCategory] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [context, setContext] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [strategy, setStrategy] = useState("");
  const [isFinding, setIsFinding] = useState(false);
  const [error, setError] = useState("");

  const chatContext = useMemo(
    () => ({
      page_type: "style_finder",
    }),
    [],
  );
  usePageChatContext(chatContext);

  const fileName = useMemo(() => file?.name || "No image selected", [file]);
  const hasConstraints = Boolean(category || budgetMax || context);
  const visibleRecommendations = recommendations.slice(0, 6);
  const analysisChips = useMemo(() => {
    if (!analysis) return [];
    return [
      ...(analysis.target_categories || []),
      ...(analysis.colors || []),
      ...(analysis.materials || []),
      ...(analysis.style_keywords || []),
      ...(analysis.occasion_keywords || []),
    ].slice(0, 8);
  }, [analysis]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleUploadKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };

  const handleFile = (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    if (nextFile.size > MAX_IMAGE_BYTES) {
      setFile(null);
      setPreview("");
      setAnalysis(null);
      setRecommendations([]);
      setStrategy("");
      setError("Image is too large. Use a JPG, PNG, or WebP under 8 MB.");
      event.target.value = "";
      trackAction("style_finder_file_rejected", { name: nextFile.name, size: nextFile.size, reason: "too_large" });
      return;
    }
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setAnalysis(null);
    setRecommendations([]);
    setStrategy("");
    setError("");
    event.target.value = "";
    trackAction("style_finder_file_selected", { name: nextFile.name, size: nextFile.size });
  };

  const handleFindSimilar = async () => {
    if (!file) {
      openFilePicker();
      return;
    }

    setIsFinding(true);
    setError("");
    try {
      const data = await getImageRecommendations({
        image: file,
        context: context || undefined,
        category: category || undefined,
        budget_max: budgetMax ? Number(budgetMax) : undefined,
        top_k: 6,
        include_preorder: true,
      });
      setAnalysis(data.analysis || null);
      setRecommendations(data.recommendations || []);
      setStrategy(data.strategy || "");
      trackAction("style_finder_image_recommendations_loaded", {
        count: data.recommendations?.length || 0,
        strategy: data.strategy,
        summary: data.analysis?.summary,
        has_constraints: hasConstraints,
      });
    } catch (err) {
      setError(imageRecommendationErrorMessage(err));
      trackAction("style_finder_image_recommendations_error", { message: err.message, status: err.response?.status });
    } finally {
      setIsFinding(false);
    }
  };

  const pipelineSteps = [
    {
      label: "Image reference",
      detail: file ? "Accepted by UI" : "Waiting for upload",
      state: file ? "ready" : "waiting",
      icon: file ? <FiCheckCircle /> : <FiImage />,
    },
    {
      label: "OpenAI image analysis",
      detail: isFinding ? "Extracting visual cues" : analysis?.summary || (file ? "Ready to analyze" : "Waiting for image"),
      state: analysis ? "ready" : isFinding ? "running" : "waiting",
      icon: analysis ? <FiCheckCircle /> : isFinding ? <FiLoader /> : <FiCpu />,
    },
    {
      label: "Style constraints",
      detail: analysisChips.length ? analysisChips.slice(0, 3).join(", ") : hasConstraints ? "Applied to image request" : "Optional filters",
      state: analysis || hasConstraints ? "ready" : "waiting",
      icon: analysis || hasConstraints ? <FiCheckCircle /> : <FiCpu />,
    },
    {
      label: "Vector/catalog retrieval",
      detail: strategy ? strategy.replace(/_/g, " ") : "Returned by API",
      state: recommendations.length ? "ready" : "waiting",
      icon: recommendations.length ? <FiCheckCircle /> : <FiCpu />,
    },
    {
      label: "Recommendations",
      detail: recommendations.length ? `${recommendations.length} products returned` : "Waiting for results",
      state: recommendations.length ? "ready" : "waiting",
      icon: recommendations.length ? <FiCheckCircle /> : <FiCpu />,
    },
  ];

  const badgeClassFor = (state) => {
    if (state === "ready") return "ready-badge";
    if (state === "running") return "running-badge";
    if (state === "backend") return "blocked-badge";
    return "soft-badge";
  };

  const badgeLabelFor = (state) => {
    if (state === "backend") return "backend";
    if (state === "running") return "running";
    if (state === "ready") return "ready";
    return "waiting";
  };

  return (
    <Container maxW="1180px" py={10}>
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 8, lg: 10 }} alignItems="start">
        <VStack align="stretch" gap={6}>
          <Box>
            <Text className="section-kicker">Style Finder</Text>
            <Text className="page-title">Upload a reference image</Text>
            <Text className="hero-copy">
              Upload a reference and let the product API translate visual cues into catalog recommendations.
            </Text>
          </Box>

          <Input ref={fileInputRef} type="file" accept="image/*" display="none" onChange={handleFile} />
          <Box
            className="upload-zone"
            role="button"
            tabIndex={0}
            onClick={openFilePicker}
            onKeyDown={handleUploadKey}
            aria-label="Choose a local image"
          >
            {preview ? (
              <img src={preview} alt="Selected style reference" className="upload-preview" />
            ) : (
              <VStack gap={3}>
                <Box className="upload-icon">
                  <FiImage />
                </Box>
                <Text className="upload-title">Choose a local image</Text>
                <Text className="muted-text">JPG, PNG, or WebP reference</Text>
              </VStack>
            )}
          </Box>

          <HStack gap={3} flexWrap="wrap">
            <Button className="secondary-button" onClick={openFilePicker}>
              <FiUploadCloud />
              Select image
            </Button>
            <Button className="primary-button" onClick={handleFindSimilar} disabled={!file} loading={isFinding}>
              <FiCamera />
              Find similar
            </Button>
          </HStack>
          <Text className="muted-text">{fileName}</Text>

          <Box className="constraint-panel">
            <Text className="panel-title">Match constraints</Text>
            <SimpleGrid columns={{ base: 1, md: 2 }} gap={3} mt={4}>
              <NativeSelect.Root>
                <NativeSelect.Field value={category} onChange={(event) => setCategory(event.target.value)} className="native-select">
                  {categoryOptions.map(([value, label]) => (
                    <option key={value || "all"} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Input
                type="number"
                min="0"
                value={budgetMax}
                onChange={(event) => setBudgetMax(event.target.value)}
                placeholder="Max price"
                className="constraint-input"
              />
            </SimpleGrid>
            <Input
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Optional style note"
              className="constraint-input"
              mt={3}
            />
          </Box>
        </VStack>

        <AiPanel title="Visual-search pipeline" strategy={strategy} reasons={pipelineSteps.map((step) => `${step.label}: ${step.detail}`)}>
          {analysis ? (
            <Box className="analysis-summary">
              <Text className="panel-title">{analysis.summary || "Visual cues extracted"}</Text>
              {analysisChips.length ? (
                <HStack gap={2} flexWrap="wrap" mt={3}>
                  {analysisChips.map((chip) => (
                    <Badge key={chip} className="ai-badge">
                      {chip.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </HStack>
              ) : null}
            </Box>
          ) : null}
          <SimpleGrid columns={{ base: 1, md: 2 }} gap={3} mt={5}>
            {pipelineSteps.map((step) => (
              <HStack key={step.label} className={`pipeline-card ${step.state}`}>
                {step.icon}
                <Box>
                  <Text>{step.label}</Text>
                  <Text className="muted-mini">{step.detail}</Text>
                  <Badge className={badgeClassFor(step.state)}>{badgeLabelFor(step.state)}</Badge>
                </Box>
              </HStack>
            ))}
          </SimpleGrid>
          {error ? <Text className="error-copy">{error}</Text> : null}
        </AiPanel>
      </SimpleGrid>

      {visibleRecommendations.length ? (
        <Box className="style-results">
          <HStack justify="space-between" align="end" gap={4} flexWrap="wrap" mb={5}>
            <Box>
              <Text className="section-kicker">Recommended edit</Text>
              <Text className="section-title">Similar starting points</Text>
            </Box>
            {strategy ? <Badge className="ai-badge">{strategy.replace(/_/g, " ")}</Badge> : null}
          </HStack>
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap={5}>
            {visibleRecommendations.map((row) => (
              <ProductCard key={row.product.id} product={row.product} compact />
            ))}
          </SimpleGrid>
        </Box>
      ) : null}
    </Container>
  );
}
