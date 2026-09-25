import { describe, expect, it } from "vitest";

import {
  cleanRelatedSkills,
  cleanResources,
  MAX_RELATED_SKILLS,
  resourceProblem,
  vocabulary,
} from "./checks";

const known = vocabulary(["Kubernetes", "Experience with Kubernetes and the CKA certification."]);

describe("resourceProblem", () => {
  it("allows generic descriptions and names the input has", () => {
    expect(resourceProblem("An introductory course on container orchestration.", known)).toBeNull();
    expect(resourceProblem("Deploy a small app to Kubernetes. Publish it on GitHub.", known))
      .toBeNull();
    expect(resourceProblem("The CKA certification, which these employers name.", known)).toBeNull();
  });

  it("flags URLs, quoted titles, and names the input doesn't have", () => {
    expect(resourceProblem("See kubernetes.io for tutorials.", known)).toBe("url");
    expect(resourceProblem("Take https://example.org/course", known)).toBe("url");
    expect(resourceProblem('Take "Kubernetes for Everyone".', known)).toBe("quoted_title");
    expect(resourceProblem("A Kubernetes Bootcamp course.", known)).toBe("unknown_name");
    expect(resourceProblem("A course on Udemy about Kubernetes.", known)).toBe("unknown_name");
    // An acronym is a name even at the start of a sentence.
    expect(resourceProblem("CKAD is a good next step.", known)).toBe("unknown_name");
    expect(resourceProblem("Acme's container course.", known)).toBe("unknown_name");
  });
});

describe("cleanRelatedSkills", () => {
  it("drops the skill itself, duplicates, and extras", () => {
    expect(
      cleanRelatedSkills(
        ["Docker", "kubernetes", " docker ", "Helm.", "Linux", "Networking", "Go", ""],
        ["Kubernetes", "k8s"],
      ),
    ).toEqual(["Docker", "Helm", "Linux", "Networking"].slice(0, MAX_RELATED_SKILLS));
  });
});

describe("cleanResources", () => {
  it("keeps one generic resource per kind and reports the rest", () => {
    const result = cleanResources(
      [
        { kind: "course", description: "  An intro course on\n container orchestration. " },
        { kind: "course", description: "Another course." },
        { kind: "certification", description: "The Udemy CKA prep course." },
        { kind: "project", description: "Deploy a three-service app to Kubernetes." },
      ],
      known,
    );
    expect(result.resources).toEqual([
      { kind: "course", description: "An intro course on container orchestration." },
      { kind: "project", description: "Deploy a three-service app to Kubernetes." },
    ]);
    expect(result.problems).toEqual(["unknown_name"]);
  });
});
