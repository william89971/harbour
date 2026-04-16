output "droplet_ip" {
  description = "Public IPv4 of the Harbour droplet. Create a DNS A record for var.domain pointing here."
  value       = digitalocean_droplet.harbour.ipv4_address
}

output "droplet_id" {
  description = "DigitalOcean droplet ID."
  value       = digitalocean_droplet.harbour.id
}

output "ssh_command" {
  description = "SSH into the droplet as root."
  value       = "ssh root@${digitalocean_droplet.harbour.ipv4_address}"
}

output "url" {
  description = "URL Harbour will be served at once DNS + cert are live."
  value       = "https://${var.domain}"
}

output "next_steps" {
  description = "What to do after terraform apply finishes."
  value       = <<-EOT

    1. Create a DNS A record:  ${var.domain}  ->  ${digitalocean_droplet.harbour.ipv4_address}
       (Cloudflare: set proxy OFF / grey cloud for the initial cert fetch)

    2. Watch cloud-init:
       ssh root@${digitalocean_droplet.harbour.ipv4_address} 'tail -f /var/log/cloud-init-output.log'

    3. When it says 'HARBOUR READY', visit https://${var.domain}
       Basic Auth: ${var.basic_auth_user} / <your configured password>

    4. Log into each CLI once (interactive auth — no headless path):
       ssh root@${digitalocean_droplet.harbour.ipv4_address}
       claude   # OAuth browser flow (or set ANTHROPIC_API_KEY)
       codex    # Browser sign-in (or set OPENAI_API_KEY)
       gemini   # OAuth browser flow (or set GEMINI_API_KEY)

  EOT
}
