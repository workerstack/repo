pub fn parse(s: &str) -> u8 {
    s.parse().unwrap()
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses() {
        assert_eq!("1".parse::<u8>().unwrap(), 1);
    }
}
