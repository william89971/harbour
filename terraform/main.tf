terraform {
  required_version = ">= 1.5.0"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

data "digitalocean_ssh_key" "keys" {
  for_each = toset(var.ssh_key_names)
  name     = each.value
}

resource "digitalocean_droplet" "harbour" {
  name     = var.droplet_name
  region   = var.region
  size     = var.size
  image    = var.image
  ssh_keys = [for k in data.digitalocean_ssh_key.keys : k.id]

  monitoring = true
  ipv6       = false

  user_data = templatefile("${path.module}/cloud-init.yml.tftpl", {
    domain              = var.domain
    letsencrypt_email   = var.letsencrypt_email
    basic_auth_user     = var.basic_auth_user
    basic_auth_password = var.basic_auth_password
    harbour_repo        = var.harbour_repo
    harbour_ref         = var.harbour_ref
  })

  tags = ["harbour"]
}

resource "digitalocean_firewall" "harbour" {
  name        = "${var.droplet_name}-fw"
  droplet_ids = [digitalocean_droplet.harbour.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
