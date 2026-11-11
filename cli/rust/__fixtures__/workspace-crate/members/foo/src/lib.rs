pub fn sum(a: u8, b: u8, c: u8, d: u8) -> u8 {
    a + b + c + d
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses() {
        assert_eq!("1".parse::<u8>().unwrap(), 1);
    }
}
