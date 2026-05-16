"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface ClientInput {
  id?: string;
  name: string;
  industry: string | null;
  contactEmail: string | null;
  isActive: boolean;
}

function parse(formData: FormData): ClientInput {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const id = get("id") || undefined;
  const name = get("name");
  const industry = get("industry") || null;
  const contactEmail = get("contactEmail") || null;
  const isActive = formData.get("isActive") != null;
  if (!name) throw new Error("Client name is required.");
  return { id, name, industry, contactEmail, isActive };
}

export async function upsertClient(formData: FormData) {
  await requireSession();
  const input = parse(formData);
  if (input.id) {
    await prisma.client.update({
      where: { id: input.id },
      data: {
        name: input.name,
        industry: input.industry,
        contactEmail: input.contactEmail,
        isActive: input.isActive,
      },
    });
  } else {
    const baseSlug = slugify(input.name) || `client-${Date.now()}`;
    let slug = baseSlug;
    let i = 2;
    while (await prisma.client.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${i++}`;
    }
    await prisma.client.create({
      data: {
        name: input.name,
        slug,
        industry: input.industry,
        contactEmail: input.contactEmail,
        isActive: input.isActive,
      },
    });
  }
  revalidatePath("/clients");
}

export async function toggleClientActive(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");
  const c = await prisma.client.findUnique({ where: { id } });
  if (!c) throw new Error("Client not found.");
  await prisma.client.update({ where: { id }, data: { isActive: !c.isActive } });
  revalidatePath("/clients");
}
