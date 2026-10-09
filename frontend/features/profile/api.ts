// features/profile/api.ts — Meu perfil: nome, foto, senha e aviso de troca de senha.

import { apiClient } from "@/lib/api-client"
import type { User } from "@/lib/auth-context"

export const profileApi = {
  updateName: (name: string) => apiClient.patch<User>("/api/auth/me", { name }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<{ access_token: string; user: User }>("/api/auth/me/password", {
      current_password: currentPassword, new_password: newPassword,
    }),

  dismissPasswordPrompt: () => apiClient.post<User>("/api/auth/me/password-prompt/dismiss"),

  uploadPhoto: (photo: Blob) => apiClient.upload<User>("/api/auth/me/photo", photo, "foto.jpg", "PUT"),

  deletePhoto: () => apiClient.delete<User>("/api/auth/me/photo"),
}

const PHOTO_SIZE = 256

/** Recorta a imagem em quadrado (centro) e reduz para 256 px, em JPEG. */
export async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = PHOTO_SIZE
  canvas.height = PHOTO_SIZE
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Não foi possível processar a imagem.")
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível processar a imagem.")), "image/jpeg", 0.85)
  })
}
