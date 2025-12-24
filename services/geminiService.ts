import { GoogleGenAI, Type } from "@google/genai";
import { FlatNode } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

const MODEL_NAME = "gemini-3-flash-preview";

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "Unique identifier (e.g., '1', '2')" },
      parentId: { type: Type.STRING, description: "ID of the manager. MUST be the string 'null' for the top-level root node." },
      name: { type: Type.STRING, description: "Full name of the employee" },
      title: { type: Type.STRING, description: "Job title" },
      department: { type: Type.STRING, description: "Department or Function name" },
      details: { type: Type.STRING, description: "Brief role details or bio" },
    },
    required: ["id", "name", "title"],
  },
};

const SYSTEM_INSTRUCTION = "You are an expert HR organizational consultant. Create a balanced and logical hierarchy. Ensure there is exactly one root node with parentId: 'null'. Return a flat list of nodes that form a valid tree structure.";

export const generateOrgStructure = async (description: string): Promise<FlatNode[]> => {
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Analyze the following organizational description and extract the hierarchy. 
    Return a flat list of employees where each employee has a unique 'id' and a 'parentId' (use string "null" if they are the root/CEO).
    Ensure every node is connected to the tree (except the root).
    
    Description: "${description}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });

  return parseResponse(response);
};

export const generateRandomOrgStructure = async (size: 'small' | 'medium' | 'large', theme: string): Promise<FlatNode[]> => {
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  const countMap = {
    small: "5 to 8",
    medium: "15 to 20",
    large: "30 to 40"
  };

  const count = countMap[size];

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Generate a fictional, realistic organizational structure for a "${theme}" context.
    The organization should have approximately ${count} employees/members.
    
    Requirements:
    1. Strictly ONE root node (CEO/Leader) with parentId: "null".
    2. Create a deep hierarchy with multiple departments and levels of management suitable for a ${size} organization.
    3. Ensure diversity in names and roles relevant to the theme.
    4. Provide interesting details for each person.
    5. Return the result as a flat list of nodes.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });

  return parseResponse(response);
}

const parseResponse = (response: any): FlatNode[] => {
  const text = response.text;
  if (!text) {
    throw new Error("No response from AI");
  }

  try {
    return JSON.parse(text) as FlatNode[];
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw new Error("Failed to parse organizational data.");
  }
}