import { z } from "zod";

/**
 * Zod schemas for runtime validation
 */

export const GetMyCoursesSchema = z.object({
  activeOnly: z.boolean().default(true),
});

export const GetUpcomingDueDatesSchema = z.object({
  daysAhead: z.number().int().min(1).max(90).default(7),
  courseId: z.number().int().positive().optional(),
});

export const GetMyGradesSchema = z.object({
  courseId: z.number().int().positive().optional(),
});

export const GetAnnouncementsSchema = z.object({
  courseId: z.number().int().positive().optional(),
  count: z.number().int().min(1).max(50).default(10),
});

/**
 * JSON Schema objects for MCP tool registration
 *
 * CRITICAL: MCP SDK v1.26.0 cannot handle Zod v4's $schema property.
 * These are manually-written JSON Schema objects.
 */

export const getMyCoursesInputSchema = {
  type: "object",
  properties: {
    activeOnly: {
      type: "boolean",
      description: "Only return currently active courses",
      default: true,
    },
  },
};

export const getUpcomingDueDatesInputSchema = {
  type: "object",
  properties: {
    daysAhead: {
      type: "number",
      description: "Number of days ahead to look for due dates",
      minimum: 1,
      maximum: 90,
      default: 7,
    },
    courseId: {
      type: "number",
      description: "Filter to a specific course ID",
    },
  },
};

export const getMyGradesInputSchema = {
  type: "object",
  properties: {
    courseId: {
      type: "number",
      description:
        "Course ID to get grades for. If omitted, returns grades for all enrolled courses.",
    },
  },
};

export const getAnnouncementsInputSchema = {
  type: "object",
  properties: {
    courseId: {
      type: "number",
      description:
        "Course ID to get announcements for. If omitted, returns recent announcements across all courses.",
    },
    count: {
      type: "number",
      description: "Maximum number of announcements to return",
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
};
