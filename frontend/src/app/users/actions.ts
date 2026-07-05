"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export type CreateUserState = {
  error: string | null;
};

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "Enter a name." };
  }

  const res = await fetch(`${apiUrl}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) {
    return { error: "Failed to create user." };
  }
  const user: { id: string } = await res.json();

  revalidatePath("/users");
  redirect(`/users/${user.id}`);
}
