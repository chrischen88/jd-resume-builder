// Curated synonym map: canonical display name → alternative spellings.
// Only true synonyms belong here. Related-but-different skills (e.g. A/B
// testing vs. experimentation) stay separate; coverage matching handles
// relatedness later. Case, spacing, hyphens, and punctuation are already
// ignored by `skillKey`, so don't list those variants. Avoid ambiguous short
// aliases (e.g. "TF" is also Terraform, "CV" is also a résumé): a wrong merge
// silently corrupts demand counts, a missed one just shows as two rows.

export const SKILL_SYNONYMS: Record<string, string[]> = {
  // Languages and runtimes
  JavaScript: ["js", "ecmascript"],
  TypeScript: ["ts"],
  Python: ["python3"],
  Go: ["golang"],
  "Node.js": ["node", "nodejs"],
  "C++": ["cpp"],
  "C#": ["csharp", "c sharp"],
  SQL: ["structured query language"],

  // ML and AI
  "Machine learning": ["ml"],
  "Deep learning": [],
  "Natural language processing": ["nlp"],
  "Computer vision": [],
  "Large language models": ["llm", "llms", "large language model"],
  "Retrieval-augmented generation": ["rag", "retrieval augmented generation"],
  "AI agents": ["agents", "agentic systems", "agentic ai", "llm agents", "autonomous agents"],
  "LLM evaluation": ["evals", "llm evals", "model evaluation for llms"],
  "Fine-tuning": ["finetuning", "fine tuning llms", "model fine-tuning"],
  "Prompt engineering": ["prompting", "prompt design"],
  MLOps: ["ml ops", "machine learning operations"],
  "Optical character recognition": ["ocr"],
  "Vector databases": ["vector database", "vector db", "vector dbs", "vector stores", "vector store"],
  Embeddings: ["embedding", "text embeddings", "vector embeddings"],
  "A/B testing": ["a/b tests", "ab testing", "split testing"],

  // Libraries and frameworks
  "scikit-learn": ["sklearn", "scikit learn"],
  PyTorch: ["torch"],
  TensorFlow: [],
  "Hugging Face": ["huggingface", "hf transformers", "hugging face transformers"],
  React: ["react.js", "reactjs"],
  "React Native": [],
  pandas: [],
  NumPy: [],

  // Data and infrastructure
  PostgreSQL: ["postgres", "psql"],
  Kubernetes: ["k8s"],
  "Amazon Web Services": ["aws"],
  "Google Cloud Platform": ["gcp", "google cloud"],
  "Microsoft Azure": ["azure"],
  "CI/CD": ["ci cd", "continuous integration", "continuous delivery", "continuous integration and delivery"],
  "Apache Spark": ["spark", "pyspark"],
  "Apache Airflow": ["airflow"],
  "Apache Kafka": ["kafka"],
  "REST APIs": ["rest api", "restful apis", "restful api"],
};
