variable "do_token" {
  type        = string
  description = "DigitalOcean API token. Prefer setting via DIGITALOCEAN_TOKEN env var or terraform.tfvars (gitignored)."
  sensitive   = true
}

variable "domain" {
  type        = string
  description = "FQDN to serve Harbour at (e.g. harbour.example.com). You MUST create an A record pointing this domain at the droplet's IP after apply — Caddy cannot issue a Let's Encrypt cert until it resolves."
  validation {
    condition     = length(var.domain) > 0 && can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.domain))
    error_message = "domain must be a valid FQDN, e.g. harbour.example.com."
  }
}

variable "letsencrypt_email" {
  type        = string
  description = "Email address for Let's Encrypt registration. Required by ACME; used for expiry notices."
  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.letsencrypt_email))
    error_message = "letsencrypt_email must be a valid email address."
  }
}

variable "basic_auth_user" {
  type        = string
  description = "HTTP Basic Auth username (shared, gates access to Harbour). Individual accounts are created inside Harbour after login."
  default     = "team"
}

variable "basic_auth_password" {
  type        = string
  description = "HTTP Basic Auth password. Generate with: openssl rand -base64 24"
  sensitive   = true
  validation {
    condition     = length(var.basic_auth_password) >= 16
    error_message = "basic_auth_password must be at least 16 characters."
  }
}

variable "droplet_name" {
  type        = string
  description = "Name for the droplet (shows up in the DigitalOcean dashboard)."
  default     = "harbour"
}

variable "region" {
  type        = string
  description = "DigitalOcean region slug (e.g. sfo3, nyc3, fra1, sgp1)."
  default     = "sfo3"
}

variable "size" {
  type        = string
  description = "Droplet size slug. s-2vcpu-4gb (~$24/mo) is a comfortable default; s-1vcpu-2gb (~$12/mo) works for light use."
  default     = "s-2vcpu-4gb"
}

variable "image" {
  type        = string
  description = "Droplet base image slug. Only Ubuntu 24.04+ is tested."
  default     = "ubuntu-24-04-x64"
}

variable "ssh_key_names" {
  type        = list(string)
  description = "Names of SSH keys already registered in your DigitalOcean account (see: doctl compute ssh-key list). These keys will have root access to the droplet."
  validation {
    condition     = length(var.ssh_key_names) > 0
    error_message = "At least one SSH key name is required. Run 'doctl compute ssh-key list' to see options."
  }
}

variable "harbour_repo" {
  type        = string
  description = "Git URL for the harbour repo to clone on the droplet."
  default     = "https://github.com/geekforbrains/harbour.git"
}

variable "harbour_ref" {
  type        = string
  description = "Git branch, tag, or commit to check out after cloning."
  default     = "main"
}

variable "ssh_allowed_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to SSH (port 22). Default is 0.0.0.0/0 (open). Lock down to your IP with e.g. [\"1.2.3.4/32\"] for more security."
  default     = ["0.0.0.0/0", "::/0"]
}
