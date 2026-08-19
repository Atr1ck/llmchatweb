import type { ImageAsset, ImageOperation } from "./types";

export const MOCK_IMAGE_FIXTURES = [
  { id: "fixture-city", url: "/mock-images/city-night.svg", width: 1200, height: 800 },
  { id: "fixture-portrait", url: "/mock-images/portrait.svg", width: 800, height: 1000 },
  { id: "fixture-collage", url: "/mock-images/collage.svg", width: 1200, height: 800 },
  { id: "fixture-variation-a", url: "/mock-images/variation-a.svg", width: 800, height: 1000 },
  { id: "fixture-variation-b", url: "/mock-images/variation-b.svg", width: 800, height: 1000 },
  { id: "fixture-variation-c", url: "/mock-images/variation-c.svg", width: 800, height: 1000 },
  { id: "fixture-variation-d", url: "/mock-images/variation-d.svg", width: 800, height: 1000 },
] as const;

export function fixtureFor(operation: ImageOperation, index = 0) {
  if (operation === "merge") return MOCK_IMAGE_FIXTURES[2];
  if (operation === "variation") return MOCK_IMAGE_FIXTURES[3 + (index % 4)];
  return MOCK_IMAGE_FIXTURES[index % 2];
}

export function assetFromFixture(
  projectId: string,
  fixture: (typeof MOCK_IMAGE_FIXTURES)[number],
  input: { prompt: string; operation: ImageOperation | "import"; parentIds?: string[] }
): ImageAsset {
  return {
    id: crypto.randomUUID(),
    projectId,
    url: fixture.url,
    width: fixture.width,
    height: fixture.height,
    prompt: input.prompt,
    operation: input.operation,
    parentIds: input.parentIds ?? [],
    createdAt: Date.now(),
  };
}

